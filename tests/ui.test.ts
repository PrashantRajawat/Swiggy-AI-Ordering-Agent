import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import vm from "node:vm";

test("address-load failure stays visible and retry enables selection without reconnecting", async () => {
  class Element {
    hidden = true;
    disabled = false;
    textContent = "";
    value = "";
    options: Element[] = [];
    handlers = new Map<string, (...args: any[]) => any>();
    addEventListener(name: string, handler: (...args: any[]) => any) { this.handlers.set(name, handler); }
    append(option: Element) { this.options.push(option); }
    querySelector() { return button; }
  }
  const button = new Element();
  const elements = new Map<string, Element>();
  const element = (name: string) => {
    if (!elements.has(name)) elements.set(name, new Element());
    return elements.get(name)!;
  };
  element("address").options.push(new Element());
  let failAddresses = true;
  const context = vm.createContext({
    document: { getElementById: element, createElement: () => new Element() },
    window: { location: { assign: () => assert.fail("A retry must not initiate sign-in") } },
    fetch: async (url: string) => {
      if (url === "/api/mcp/status") return { ok: true, json: async () => ({ mode: "live", authenticated: true }) };
      assert.equal(url, "/api/addresses?page=1");
      if (failAddresses) return { ok: false, status: 502, json: async () => ({ error: "Swiggy response could not be parsed" }) };
      return { ok: true, json: async () => ({ addresses: [{ id: "home-1", addressLine: "Test address" }], pagination: { page: 1, hasMore: false } }) };
    },
  });
  vm.runInContext(readFileSync("public/app.js", "utf8"), context);
  await setImmediate();
  assert.equal(element("connect-swiggy").hidden, true);
  assert.equal(element("retry-addresses").hidden, false);
  assert.match(element("connection-status").textContent, /could not be loaded/);
  assert.equal(button.disabled, true);
  await element("recommend-form").handlers.get("submit")!({ preventDefault() {} });
  assert.equal(element("output").textContent, "Swiggy response could not be parsed");
  failAddresses = false;
  element("retry-addresses").handlers.get("click")!();
  assert.equal(button.disabled, true);
  await setImmediate();
  assert.equal(element("address-panel").hidden, false);
  assert.equal(element("address").options.length, 2);
  assert.equal(element("retry-addresses").hidden, true);
  assert.equal(button.disabled, true);
  element("address").value = "home-1";
  element("address").handlers.get("change")!();
  assert.equal(button.disabled, false);
});
