import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SwiggyMcpClient } from "../src/mcp/client";
import { ChatAgent } from "../src/chat/agent";
import { ChatState } from "../src/chat/store";

const base = (): ChatState => ({ dishes: [], quantity: 1, diet: "any", allergies: [], dislikes: [], premium: false, faster: false, restaurants: [] });
const agent = () => new ChatAgent(new SwiggyMcpClient({ useMock: true }));
process.env.OPENAI_API_KEY = "";

test("follow-ups retain dish and quantity, then return at most five budgeted cards", async () => {
  const a = agent();
  const first = await a.resolve("Pizza",base(),[]);
  assert.equal(first.state.budget,undefined);
  assert.match(first.text,/budget/);
  const next = await a.resolve("Under ₹500 for two", first.state,[]);
  assert.deepEqual(next.state.dishes,["pizza"]);
  assert.equal(next.state.quantity,2);
  assert.ok(next.cards.length > 0 && next.cards.length <= 5);
  assert.ok(next.cards.every(c => c.total <= 500 && c.items.reduce((n,i) => n+i.quantity,0) === 2));
});
test("offline prompts, vegetarian starters, refinements and temporary preferences work", async () => {
  const a = agent();
  const first = await a.resolve("Vegetarian pizza under ₹400",base(),[]);
  assert.equal(first.state.diet,"vegetarian"); assert.ok(first.cards.length);
  const cheaper = await a.resolve("Show cheaper options", first.state,[]);
  assert.deepEqual(cheaper.state.dishes,["pizza"]); assert.equal(cheaper.state.budget,320);
  const avoid = await a.resolve("No mushrooms today",first.state,[]);
  assert.ok(avoid.state.dislikes.includes("mushrooms")); assert.equal(avoid.remember.dislikes,undefined);
  const change = await a.resolve("Try another dish",first.state,[]);
  assert.equal(change.state.dishes.length,0);
  const surprise = await a.resolve("Anything is fine, surprise me",base(),[]);
  assert.equal(surprise.state.budget,350); assert.ok(surprise.cards.length);
});
test("multi-dish meals stay in one restaurant and respect a strict budget", async () => {
  const result = await agent().resolve("Pizza and garlic bread under ₹900",base(),[]);
  assert.deepEqual(result.state.dishes,["pizza","garlic bread"]);
  assert.ok(result.cards.length);
  assert.ok(result.cards.every(c => c.restaurant === "Slice Street" && c.items.some(i => /bread/i.test(i.name)) && c.items.some(i => /pizza/i.test(i.name))));
});
test("over-budget options ask permission without silently increasing the budget", async () => {
  const result = await agent().resolve("Pizza under ₹50",base(),[]);
  assert.equal(result.state.budget,50); assert.match(result.text,/increase your budget/);
  assert.ok(result.cards.every(c => c.overBudget));
  const retry = await agent().resolve("Increase budget to ₹400",result.state,[]);
  assert.equal(retry.state.budget,400); assert.ok(retry.cards.length);
});
test("allergies stay visible and assistant replies stream verified text offline", async () => {
  const result = await agent().resolve("Pizza under ₹400, allergic to peanuts",base(),[]);
  assert.ok(result.state.allergies.includes("peanuts"));
  assert.match(result.text,/cross-contamination/);
  let text = ""; let chunks = 0;
  for await (const token of agent().reply(result)) { text += token; chunks++; }
  assert.equal(text,result.text); assert.ok(chunks > 1);
});
test("SQLite chats are owner-scoped and survive reopening the database", async () => {
  const dir = mkdtempSync(path.join(tmpdir(),"crave-store-"));
  process.env.SQLITE_DB_PATH = path.join(dir,"test.db");
  const store = await import("../src/chat/store");
  const { db } = await import("../src/memory/sqlite");
  try {
    const owner = store.session(); const other = store.session(); const chat = store.createChat(owner);
    store.appendMessage(owner,chat.id,{ id: "message", role: "user", text: "Pizza" });
    assert.equal(store.getChat(other,chat.id),undefined);
    assert.equal(store.listChats(other).length,0);
    assert.equal(store.session(owner),owner);
    assert.equal(store.getChat(owner,chat.id)!.messages[0].text,"Pizza");
    store.deleteChat(other,chat.id); assert.ok(store.getChat(owner,chat.id));
    // Independent SQLite connection reads the committed on-disk transcript.
    const Database = (await import("better-sqlite3")).default;
    const reopened = new Database(process.env.SQLITE_DB_PATH);
    assert.equal((reopened.prepare("SELECT COUNT(*) AS n FROM chat_messages").get() as any).n,1);
    reopened.close();
    store.deleteChat(owner,chat.id); assert.equal(store.getChat(owner,chat.id),undefined);
  } finally { db.close(); rmSync(dir,{ recursive: true, force: true }); }
});


test("missing details work without Swiggy and failed searches preserve intent for retry", async () => {
  class UnavailableClient extends SwiggyMcpClient {
    calls = 0;
    override async invokeTool<T>(): Promise<T> { this.calls++; throw new Error("Simulated upstream rate limit"); }
  }
  const client = new UnavailableClient({ useMock: false, accessToken: "fixture-token" });
  const a = new ChatAgent(client);
  const first = await a.resolve("Pizza",base(),[]);
  assert.match(first.text,/budget/);
  assert.equal(client.calls,0);
  let saved = first.state;
  await assert.rejects(a.resolve("Under ₹500 for two",saved,[],"home", state => { saved = state; }),/upstream rate limit/);
  assert.deepEqual(saved.dishes,["pizza"]);
  assert.equal(saved.quantity,2);
  assert.equal(saved.budget,500);
  await assert.rejects(a.resolve("Retry last search",saved,[],"home",state => { saved = state; }),/upstream rate limit/);
  assert.deepEqual(saved.dishes,["pizza"]);
  assert.equal(saved.budget,500);
});
