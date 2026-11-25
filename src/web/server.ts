import "dotenv/config";
import path from "node:path";
import express from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { AgentOrchestrator } from "../agent/orchestrator";
import { SwiggyMcpClient, SwiggyAuthError, SwiggyRateLimitError } from "../mcp/client";
import { AddressMcpService } from "../mcp/address";
import * as store from "../chat/store";
import { ChatAgent } from "../chat/agent";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const clients = new Map<string, SwiggyMcpClient>();
const busy = new Set<string>();
function context(res: express.Response): { owner: string; client: SwiggyMcpClient } {
  const owner = res.locals.owner as string;
  let client = clients.get(owner);
  // Web sessions must never inherit a shared CLI access token.
  if (!client) { client = new SwiggyMcpClient({ accessToken: undefined }); clients.set(owner, client); }
  return { owner, client };
}
app.use((req, res, next) => {
  const hosts = [`localhost:${port}`, `127.0.0.1:${port}`];
  if (!hosts.includes(req.headers.host ?? "")) { res.status(403).json({ error: "Open this app through localhost." }); return; }
  if (req.headers.origin && !hosts.some(host => req.headers.origin === `http://${host}`)) { res.status(403).json({ error: "Requests must come from this app." }); return; }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  next();
});
app.use(express.json({ limit: "16kb" }));
app.use(express.static(path.resolve(process.cwd(), "public")));
app.use("/api", (req, res, next) => {
  const cookie = req.headers.cookie?.split(";").map(p => p.trim()).find(p => p.startsWith("food_session="))?.slice(13);
  const owner = store.session(cookie);
  res.locals.owner = owner;
  if (owner !== cookie) res.cookie("food_session", owner, { httpOnly: true, sameSite: "lax", maxAge: 365 * 86400000, path: "/" });
  next();
});
function sendError(res: express.Response, error: unknown): void {
  if (error instanceof SwiggyRateLimitError) {
    res.setHeader("Retry-After", Math.max(1, Math.ceil((error.retryAt - Date.now()) / 1000)));
    res.status(429).json({ error: error.message, retryAt: error.retryAt }); return;
  }
  res.status(error instanceof z.ZodError ? 400 : error instanceof SwiggyAuthError ? 401 : 502).json({ error: error instanceof z.ZodError ? "Please check the supplied fields." : error instanceof Error ? error.message : "The request could not be completed." });
}
app.get("/api/mcp/status", (_req, res) => res.json(context(res).client.getStatus()));
app.post("/api/mcp/auth/start", async (_req, res) => {
  try {
    const { authorizeUrl, state } = await context(res).client.startAuthorization();
    res.cookie("swiggy_oauth_state", state, { httpOnly: true, sameSite: "lax", maxAge: 600000, path: "/api/mcp/auth/callback" });
    res.json({ authorizeUrl });
  } catch (error) { sendError(res, error); }
});
app.get("/api/mcp/auth/callback", async (req, res) => {
  try {
    const { code, state } = z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(req.query);
    const cookieState = req.headers.cookie?.split(";").map(p => p.trim()).find(p => p.startsWith("swiggy_oauth_state="))?.slice("swiggy_oauth_state=".length);
    if (state !== cookieState) throw new Error("Authorization browser session does not match. Connect Swiggy again.");
    res.clearCookie("swiggy_oauth_state", { path: "/api/mcp/auth/callback" });
    await context(res).client.completeAuthorization(code, state);
    res.redirect("/?connected=1");
  } catch (error) { sendError(res, error); }
});
app.get("/api/mcp/tools", async (_req, res) => {
  try { res.json({ tools: await context(res).client.listTools() }); } catch (e) { sendError(res,e); }
});
app.get("/api/addresses", async (req, res) => {
  try { res.json(await new AddressMcpService(context(res).client).getAddresses(z.coerce.number().int().min(1).max(100).parse(req.query.page ?? 1))); }
  catch (e) { sendError(res,e); }
});
const profileSchema = z.object({ budget: z.number().positive().max(100000).optional(), diet: z.enum(["any", "vegetarian", "vegan"]), allergies: z.array(z.string().trim().min(1).max(80)).max(20), dislikes: z.array(z.string().trim().min(1).max(80)).max(20), addressId: z.string().max(200).optional(), addressLabel: z.string().max(600).optional() });
app.get("/api/profile", (_req,res) => res.json(store.profile(context(res).owner)));
app.put("/api/profile", (req,res) => {
  try { const value = profileSchema.parse(req.body); store.saveProfile(context(res).owner,value); res.json(value); } catch (e) { sendError(res,e); }
});
app.get("/api/chats", (_req,res) => res.json(store.listChats(context(res).owner)));
app.post("/api/chats", (_req,res) => res.status(201).json(store.createChat(context(res).owner)));
app.get("/api/chats/:id", (req,res) => {
  const chat = store.getChat(context(res).owner, req.params.id);
  if (!chat) { res.status(404).json({ error: "Chat not found." }); return; } res.json(chat);
});
app.delete("/api/chats/:id", (req,res) => {
  const { owner } = context(res);
  if (busy.has(req.params.id)) { res.status(409).json({ error: "Wait for the current reply to finish." }); return; }
  store.deleteChat(owner, req.params.id); res.json({ ok: true });
});
app.post("/api/chats/:id/messages", async (req,res) => {
  const { owner, client } = context(res);
  const chat = store.getChat(owner, req.params.id);
  if (!chat) { res.status(404).json({ error: "Chat not found." }); return; }
  if (busy.has(chat.id)) { res.status(409).json({ error: "A reply is already in progress." }); return; }
  let message: string;
  try {
    message = z.object({ message: z.string().trim().min(1).max(2000) }).parse(req.body).message;

  } catch(e) { sendError(res,e); return; }
  busy.add(chat.id);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const emit = (event: string, data: unknown) => { if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  const heartbeat = setInterval(() => { if (!res.destroyed) res.write(": keepalive\n\n"); }, 15000);
  store.appendMessage(owner,chat.id,{ id: randomUUID(), role: "user", text: message });
  let pendingState = chat.state;
  try {
    emit("status", { text: "Understanding your craving…" });
    const agent = new ChatAgent(client);
    const p = store.profile(owner);
    const result = await agent.resolve(message, chat.state, chat.messages, p.addressId, state => { pendingState = state; });
    emit("status", { text: result.cards.length ? "Putting your recommendations together…" : "Preparing a reply…" });
    let text = "";
    for await (const token of agent.reply(result)) { text += token; emit("delta", { text: token }); }
    const reply: store.ChatMessage = { id: randomUUID(), role: "assistant", text, cards: result.cards, suggestions: result.suggestions };
    store.appendMessage(owner, chat.id, reply, result.state);
    store.saveProfile(owner,{ ...store.profile(owner), ...result.remember });
    emit("done", reply);
  } catch (e) {
    const text = e instanceof Error ? e.message : "I couldn’t complete this search. Please try again.";
    const reply: store.ChatMessage = { id: randomUUID(), role: "assistant", text: `I couldn’t finish that request. ${text}`, suggestions: e instanceof SwiggyRateLimitError ? ["Retry last search"] : [message] };
    store.appendMessage(owner, chat.id, reply, pendingState);
    if (e instanceof SwiggyRateLimitError) emit("rate_limited", { retryAt: e.retryAt });
    if (e instanceof SwiggyAuthError) emit("auth_required", { text });
    emit("done",reply);
  } finally { clearInterval(heartbeat); busy.delete(chat.id); res.end(); }
});
// Retain the recommendation endpoint for existing CLI/API consumers.
app.post("/api/recommend", async (req,res) => {
  try {
    const { query, addressId, ...preferences } = z.object({ query: z.string().trim().min(1).max(500), addressId: z.string().min(1).optional(), budget: z.number().positive().max(100000).optional(), quantity: z.number().int().min(1).max(6).optional(), premium: z.boolean().optional(), dislikes: z.array(z.string()).max(20).optional(), deliveryTimeWeight: z.number().min(0).max(10).optional() }).parse(req.body);
    res.json(await new AgentOrchestrator(context(res).client,true).handleRequest({ message: query, addressId, preferences }));
  } catch(e) { sendError(res,e); }
});
// Checkout is intentionally unavailable until cart review and verified totals are implemented.
app.post("/api/order", (_req,res) => res.status(409).json({ error: "Checkout is coming in the next phase. No order has been placed." }));
app.get("/health", (_req,res) => res.json({ ok: true }));
const server = app.listen(port,"127.0.0.1",() => console.log(`Swiggy AI web UI running on http://localhost:${port}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  server.close(); void Promise.allSettled([...clients.values()].map(client => client.close())).finally(() => process.exit(0));
});
