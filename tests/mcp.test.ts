import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { SwiggyMcpClient, SwiggyAuthError, decodeToolResult } from "../src/mcp/client";
import { AddressMcpService } from "../src/mcp/address";
import { RestaurantMcpService } from "../src/mcp/restaurant";
import { MenuMcpService } from "../src/mcp/menu";
import { OffersMcpService } from "../src/mcp/offers";
import { OrdersMcpService } from "../src/mcp/orders";
import { generateCombinations } from "../src/recommendation/combinations";

async function fixture(directPayload = false, groupedMenu = false) {
  const calls: Array<{ method: string; params?: any }> = [];
  const authBodies: Record<string, any> = {};
  let rejected = false;
  const server = createServer(async (req, res) => {
    if (req.method === "GET") { res.writeHead(405).end(); return; }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    if (req.url?.startsWith("/auth/")) {
      authBodies[req.url] = body;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(req.url === "/auth/register" ? { client_id: "registered-client" } : { access_token: "test-token", expires_in: 300 }));
      return;
    }
    assert.equal(req.url, "/food");
    assert.equal(req.headers.authorization, "Bearer test-token");
    if (rejected) { res.writeHead(401).end(); return; }
    calls.push(body);
    let result: unknown;
    switch (body.method) {
      case "initialize":
        result = { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "local-test", version: "1" } };
        res.setHeader("mcp-session-id", "fixture-session");
        break;
      case "notifications/initialized":
        assert.equal(req.headers["mcp-session-id"], "fixture-session");
        res.writeHead(202).end(); return;
      case "tools/list":
        assert.equal(req.headers["mcp-session-id"], "fixture-session");
        result = body.params?.cursor ? {
          tools: ["get_restaurant_menu", "place_food_order"].map((name) => ({ name, inputSchema: { type: "object" } })),
        } : {
          tools: ["get_addresses", "search_restaurants"].map((name) => ({ name, inputSchema: { type: "object" } })), nextCursor: "page-2",
        };
        break;
      case "tools/call": {
        const { name, arguments: args } = body.params;
        let data: unknown;
        if (name === "get_addresses") {
          data = { addresses: [{ id: "home-1", addressLine: "Test street", phoneNumber: "private", addressTag: "Home" }], pagination: { page: 1, hasMore: false } };
        } else if (name === "search_restaurants") {
          assert.deepEqual(args, { query: "waffles", addressId: "home-1" });
          data = { restaurants: [
            { id: "open-1", name: "Open Waffles", avgRating: 4.5, availabilityStatus: "OPEN", deliveryTimeMinutes: 20, distanceKm: 2 },
            { id: "closed-1", name: "Closed", availabilityStatus: "CLOSED" },
            { name: "Missing ID", availabilityStatus: "OPEN" },
          ] };
        } else if (name === "get_restaurant_menu") {
          assert.deepEqual(args, { restaurantId: "open-1", addressId: "home-1", ...(args.page ? { page: args.page } : {}) });
          data = { restaurant: { isOpen: true }, items: [
            { id: "item-1", name: "Chocolate Waffle", price: 199, inStock: 1, categories: ["Waffles"] },
            { id: "item-2", name: "Sold out", price: 99, inStock: 0, categories: [] },
            { id: "item-3", name: "No price", inStock: 1, categories: [] },
          ] };
          if (groupedMenu) {
            data = args.page === 2 ? {
              restaurant: { isOpen: true }, page: 2, hasMore: false,
              categories: [{ title: "Desserts", subcategories: [{ title: "Brownies", items: [{ id: "item-4", name: "Brownie", price: 99, inStock: 1 }] }] }],
            } : {
              restaurant: { isOpen: true }, page: 1, hasMore: true,
              categories: [
                { title: "Waffles", items: [
                  { id: "item-1", name: "Chocolate Waffle", price: 199, inStock: 1 },
                  { id: "item-2", name: "Sold out", price: 99, inStock: 0 },
                  { id: "item-3", name: "No price", inStock: 1 },
                ] },
                { title: "Recommended", items: [{ id: "item-1", name: "Chocolate Waffle", price: 199, inStock: 1 }] },
              ],
            };
          }
        } else {
          result = { isError: true, content: [{ type: "text", text: "simulated order failure" }] };
          break;
        }
        const envelope = { success: true, data };
        result = name === "get_addresses"
          ? { content: [{ type: "text", text: JSON.stringify(directPayload ? data : envelope) }] }
          : { content: [], structuredContent: directPayload ? data : envelope };
        break;
      }
      default: throw new Error(`Unexpected method ${body.method}`);
    }
    const response = JSON.stringify({ jsonrpc: "2.0", id: body.id, result });
    if (body.method === "tools/call") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(`event: message\ndata: ${response}\n\n`);
    } else {
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(response);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/food`;
  const client = new SwiggyMcpClient({ endpoint, accessToken: "test-token", clientId: undefined, useMock: false, timeoutMs: 2000, redirectUri: "http://localhost/callback" });
  return { client, calls, authBodies, reject: () => { rejected = true; }, close: async () => {
    await client.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  } };
}

test("real SDK handshake, discovery pagination, session headers, SSE and Swiggy response normalization", async () => {
  const f = await fixture();
  try {
    const addresses = new AddressMcpService(f.client);
    const page = await addresses.getAddresses();
    assert.equal(page.addresses[0].id, "home-1");
    assert.equal("phoneNumber" in page.addresses[0], false);
    assert.equal(await addresses.requireAddress("home-1"), "home-1");
    await assert.rejects(addresses.requireAddress("invented"), /no longer available/);
    const restaurants = await new RestaurantMcpService(f.client).searchRestaurants("waffles", "home-1");
    assert.equal(restaurants.length, 1);
    assert.equal(restaurants[0].rating, 4.5);
    assert.equal(restaurants[0].pricingIsEstimate, true);
    const items = await new MenuMcpService(f.client).getRestaurantMenu("open-1", "home-1");
    assert.deepEqual(items.map((i) => [i.id, i.price]), [["item-1", 199]]);
    assert.deepEqual(await new OffersMcpService(f.client).getRecommendationCoupons(), []);
    assert.equal((await f.client.listTools()).length, 4);
    assert.equal(f.calls.filter((c) => c.method === "initialize").length, 1);
    assert.equal(f.calls.filter((c) => c.method === "tools/list").length, 2);
    assert.equal(f.calls.some((c) => c.params?.name?.includes("cart")), false);
    await assert.rejects(f.client.invokeTool("get_menu", {}, () => null), /does not currently advertise/);
  } finally { await f.close(); }
});

test("PKCE registration, one-use state, client identity and token expiry", async () => {
  const f = await fixture();
  try {
    const auth = await f.client.startAuthorization();
    const url = new URL(auth.authorizeUrl);
    assert.equal(url.pathname, "/auth/authorize");
    assert.equal(url.searchParams.get("client_id"), "registered-client");
    assert.deepEqual(f.authBodies["/auth/register"].redirect_uris, ["http://localhost/callback"]);
    await assert.rejects(f.client.completeAuthorization("code", "bad-state"), /Invalid or expired/);
    assert.deepEqual(await f.client.completeAuthorization("code", auth.state), { expiresIn: 300 });
    const exchange = f.authBodies["/auth/token"];
    assert.equal(exchange.client_id, "registered-client");
    assert.equal(createHash("sha256").update(exchange.code_verifier).digest("base64url"), url.searchParams.get("code_challenge"));
    await assert.rejects(f.client.completeAuthorization("code", auth.state), /Invalid or expired/);
    await f.client.setAccessToken("test-token", -1);
    assert.equal(f.client.hasAccessToken(), false);
    await assert.rejects(f.client.listTools(), SwiggyAuthError);
  } finally { await f.close(); }
});

test("authentication failure clears session; orders require confirmation and are never retried", async () => {
  const f = await fixture();
  try {
    const orders = new OrdersMcpService(f.client);
    await assert.rejects(orders.placeOrder({ addressId: "home-1", paymentMethod: "Cash" }, false), /confirmation/);
    assert.equal(f.calls.length, 0);
    await assert.rejects(orders.placeOrder({ addressId: "home-1", paymentMethod: "Cash" }, true), /could not complete/);
    assert.equal(f.calls.filter((c) => c.params?.name === "place_food_order").length, 1);
    f.reject();
    await assert.rejects(new AddressMcpService(f.client).getAddresses(), SwiggyAuthError);
    assert.equal(f.client.hasAccessToken(), false);
  } finally { await f.close(); }
});

test("malformed and failed envelopes cannot become successful recommendations", () => {
  assert.throws(() => decodeToolResult({ content: [{ type: "text", text: "not JSON" }] }), /unsupported/);
  assert.throws(() => decodeToolResult({ structuredContent: { success: false, error: { message: "failure" } } }), /tool error/);
  assert.throws(() => decodeToolResult({ structuredContent: { success: true } }), /no tool data/);
});

test("mock mode stays offline and real menu combination work is bounded", async () => {
  const client = new SwiggyMcpClient({ useMock: true, endpoint: "http://127.0.0.1:1/food" });
  const addressId = await new AddressMcpService(client).requireAddress();
  assert.ok((await new RestaurantMcpService(client).searchRestaurants("waffles", addressId)).length);
  assert.ok((await new OffersMcpService(client).getRecommendationCoupons()).length);
  const items = Array.from({ length: 150 }, (_, i) => ({ name: `Item ${i}`, price: 100, category: "Food" }));
  assert.equal(generateCombinations(items, 6).length, 20000);
  assert.deepEqual(generateCombinations(items, 1.5), []);
});


test("direct Swiggy tool payloads work in both JSON text and structured content", async () => {
  const f = await fixture(true);
  try {
    const addresses = await new AddressMcpService(f.client).getAddresses();
    assert.equal(addresses.addresses[0].id, "home-1");
    const restaurants = await new RestaurantMcpService(f.client).searchRestaurants("waffles", "home-1");
    assert.equal(restaurants[0].id, "open-1");
    const menu = await new MenuMcpService(f.client).getRestaurantMenu("open-1", "home-1");
    assert.equal(menu[0].id, "item-1");
  } finally { await f.close(); }
});

test("nested payloads unwrap while error responses still fail", () => {
  const data = { addresses: [], pagination: { page: 1, hasMore: false } };
  assert.deepEqual(decodeToolResult({ structuredContent: { result: { success: true, data } } }), data);
  assert.deepEqual(decodeToolResult({ content: [{ type: "text", text: JSON.stringify({ data }) }] }), data);
  assert.throws(() => decodeToolResult({ structuredContent: { result: { success: false, data } } }), /tool error/);
});

test("upstream schema errors identify the tool and field without exposing values", async () => {
  const { parseToolData, SwiggyResponseError } = await import("../src/mcp/validation");
  const { z } = await import("zod");
  assert.throws(() => parseToolData("get_restaurant_menu", z.object({ items: z.array(z.object({ price: z.number() })) }), {
    items: [{ price: "private-value" }],
  }), (error: unknown) => {
    assert.ok(error instanceof SwiggyResponseError);
    assert.match(error.message, /get_restaurant_menu/);
    assert.match(error.message, /items.0.price/);
    assert.match(error.message, /received string/);
    assert.equal(error.message.includes("private-value"), false);
    return true;
  });
});


test("live category menus are paginated and deduplicated without losing category labels", async () => {
  const f = await fixture(true, true);
  try {
    const items = await new MenuMcpService(f.client).getRestaurantMenu("open-1", "home-1");
    assert.deepEqual(items.map((item) => [item.id, item.price]), [["item-1", 199], ["item-4", 99]]);
    assert.equal(items[0].category, "Waffles / Recommended");
    assert.equal(items[1].category, "Desserts/Brownies");
    const menuCalls = f.calls.filter((call) => call.params?.name === "get_restaurant_menu");
    assert.equal(menuCalls.length, 2);
    assert.equal(menuCalls[1].params.arguments.page, 2);
  } finally { await f.close(); }
});

test("unexpected menu shapes are upstream errors, not invalid user input", async () => {
  const { normalizeMenuPage } = await import("../src/mcp/menu");
  assert.throws(() => normalizeMenuPage({ restaurant: { isOpen: true } }), /get_restaurant_menu.*items/);
  assert.deepEqual(normalizeMenuPage({ restaurant: { isOpen: false }, categories: [], hasMore: true }).items, []);
  assert.equal(normalizeMenuPage({ restaurant: { isOpen: false }, categories: [], hasMore: true }).hasMore, false);
});

test("protein roll items keep their main dish when a dip or add-on is named alongside it", async () => {
  const { dishRelevance } = await import("../src/recommendation/relevance");
  const valid = [
    { name: "Chicken Roll - BBQ Dip", category: "Chicken Rolls", price: 150 },
    { name: "Chicken Roll with Mayo", category: "Chicken Rolls", price: 160 },
    { name: "Crispy Chicken Roll", category: "Chicken Rolls", price: 170 },
  ];
  const invalid = [
    { name: "Barbeque Dip", category: "Chicken Rolls", price: 25 },
    { name: "Peri Peri Dip", category: "Chicken Rolls", price: 35 },
  ];

  for (const item of valid) {
    assert.equal(dishRelevance(item as any, "chicken roll"), 1);
  }
  for (const item of invalid) {
    assert.equal(dishRelevance(item as any, "chicken roll"), 0);
  }
});
