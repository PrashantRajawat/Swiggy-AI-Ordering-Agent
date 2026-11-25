import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import vm from "node:vm";

test("chat onboarding keeps address failures retryable and renders cards without raw JSON", async () => {
  class Element {
    hidden = false; disabled = false; textContent = ""; value = ""; open = false; className = "";
    children: Element[] = []; options: Element[] = []; style = {}; scrollHeight = 50; scrollTop = 0;
    handlers = new Map<string, (...args: any[]) => any>();
    classList = { add() {}, remove() {}, toggle() {} };
    addEventListener(name: string, handler: (...args: any[]) => any) { this.handlers.set(name,handler); }
    append(...elements: Element[]) { this.children.push(...elements); this.options.push(...elements.filter(e => e instanceof Option)); }
    replaceChildren() { this.children = []; }
    setAttribute() {} focus() {} remove() {} showModal() { this.open = true; } close() { this.open = false; }
  }
  class Option extends Element {}
  const elements = new Map<string, Element>();
  const element = (id: string) => { if (!elements.has(id)) elements.set(id,new Element()); return elements.get(id)!; };
  element("address").options.push(new Option());
  let fail = true;
  let streamReply = false;
  let rateLimited = false;
  let streamRequests = 0;
  let useSavedAddress = false;
  let addressRequests = 0;
  const context = vm.createContext({
    document: { getElementById: element, createElement: (tag: string) => tag === "option" ? new Option() : new Element(), createTextNode: (text: string) => Object.assign(new Element(), { textContent: text }) },
    window: { location: { assign() { assert.fail("Retry should not reconnect"); } } },
    TextDecoder,
    setInterval: () => 1, clearInterval: () => {},
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }, Intl,
    fetch: async (url: string) => {
      const response = (data: unknown, ok = true) => ({ ok, status: ok ? 200 : 502, json: async () => data });
      if (streamReply && url.endsWith("/messages")) {
        streamRequests++;
        let sent = false;
        const events = rateLimited ? `event: rate_limited\ndata: ${JSON.stringify({retryAt:Date.now()+60000})}\n\nevent: done\ndata: {"role":"assistant","text":"Please wait before trying again."}\n\n` : `event: auth_required\ndata: {"text":"Your Swiggy session expired. Connect Swiggy again."}\n\nevent: done\ndata: {"role":"assistant","text":"Please reconnect Swiggy."}\n\n`;
        return { ok: true, status: 200, body: { getReader: () => ({ read: async () => {
          if (sent) return { done: true, value: undefined };
          sent = true; return { done: false, value: new TextEncoder().encode(events) };
        } }) } };
      }
      if (url === "/api/mcp/status") return response({ mode: "live", authenticated: true });
      if (url === "/api/profile") return response({ diet: "any", allergies: [], dislikes: [], ...(useSavedAddress ? { addressId: "home", addressLabel: "Saved home" } : {}) });
      if (url === "/api/chats") return response([]);
      assert.equal(url,"/api/addresses?page=1");
      addressRequests++;
      return fail ? response({ error: "Unexpected address format" },false) : response({ addresses: [{ id: "home", addressLine: "Test address" }], pagination: { page: 1, hasMore: false } });
    },
  });
  vm.runInContext(readFileSync("public/app.js","utf8"),context);
  await setImmediate();
  assert.equal(element("send").disabled,false);
  assert.equal(element("retry-addresses").hidden,false);
  assert.match(element("connection-status").textContent,/could not be loaded/);
  fail = false;
  element("retry-addresses").handlers.get("click")!();
  await setImmediate();
  assert.equal(element("address-panel").hidden,false);
  assert.equal(element("address").options.length,2);
  assert.equal(element("retry-addresses").hidden,true);
  vm.runInContext(`renderMessage({role:'assistant',text:'Here is a match.',cards:[{restaurant:'Test Pizza',rating:4.5,items:[{name:'Pizza',quantity:1,unitPrice:200}],total:200,deliveryFee:0,estimate:true}]})`,context);
  const tree = (e: Element): string => [e.textContent,...e.children.map(tree)].join(" ");
  const rendered = tree(element("messages"));
  assert.match(rendered,/Test Pizza/);
  assert.match(rendered,/Estimated item total/);
  assert.match(rendered,/Checkout coming next/);
  assert.doesNotMatch(rendered,/"restaurant":/);
  element("onboarding").close();
  streamReply = true;
  await vm.runInContext(`profile.addressId = 'home'; activeChat = {id:'test-chat'}; sendMessage('Pizza under ₹350')`,context);
  assert.equal(element("connect-swiggy").hidden,false);
  assert.equal(element("connection-banner").hidden,false);
  assert.equal(element("send").disabled,false);
  assert.match(element("onboarding-status").textContent,/session expired/);
  rateLimited = true;
  await vm.runInContext(`authenticated = true; profile.addressId = 'home'; sendMessage('Pizza under ₹350')`,context);
  assert.equal(element("send").disabled,false);
  assert.match(element("chat-status").textContent,/Live search is paused/);
  const requests = streamRequests;
  await vm.runInContext(`sendMessage('Pizza under ₹350')`,context);
  assert.equal(streamRequests,requests+1);
  assert.equal(element("onboarding").open,false);
  useSavedAddress = true;
  const reads = addressRequests;
  await vm.runInContext(`addressPage = 0; init()`,context);
  assert.equal(addressRequests,reads);
  assert.equal(element("current-address").textContent,"Saved home");
  assert.equal(element("onboarding").open,false);
});
