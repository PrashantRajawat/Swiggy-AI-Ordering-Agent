# Swiggy AI Ordering Agent

A personal food recommendation app with a CLI and a small web UI. It extracts preferences from natural language, searches menus, and compares item combinations within a budget.

## Chat experience (phase 1)

The web app now opens as **Crave**, a responsive orange-themed chat interface with suggested prompts, a history sidebar, streamed assistant replies, clickable follow-ups, and up to five recommendation cards. There are no required budget/quantity forms in the main flow. The agent carries dish, budget, quantity, diet and exclusions across messages; it defaults to one item/person, asks for a budget when missing, and can choose a ₹350 pizza search when invited to pick anything. Multi-dish requests such as pizza and garlic bread are assembled from one restaurant. Quantity still means menu items rather than inferred portions.

Conversations, selected address, and editable preferences persist in SQLite. Each browser receives a random HttpOnly session cookie; chats and in-memory Swiggy clients are scoped to that session. This is **browser-local identity, not an app account**: clearing cookies loses access to that browser's history, and another browser/device does not share it. Swiggy tokens remain in memory, so reconnect after restarting the server. Web sessions deliberately do not inherit the CLI's environment access token.

The onboarding dialog connects Swiggy and selects an address. Demo mode supports the same chat UI using sample addresses and food. With an OpenAI key, the agent extracts contextual updates and streams model-generated prose; without one, deterministic parsing and text chunks keep demo mode usable. The offline parser supports common prompts/refinements rather than unrestricted language understanding. Cards show menu-based estimates, rating/ETA where available, item quantities and demo discounts. Live coupons, customization, real cart totals, and checkout remain phase 2. The previous direct-order API is disabled so recommendation cards cannot place an unreviewed order.

Preferences without “today”, “tonight”, “this time”, “this order”, or “for now” are remembered automatically. Settings edits apply to new chats. Dietary/allergen filters inspect menu names; they cannot certify ingredients or cross-contamination. Always verify allergies directly with the restaurant.

This remains a localhost development app. Before public hosting, add real app-account authentication, secure persistent per-user Swiggy credentials, HTTPS, appropriate session/rate limits, and a deployment-compatible database. SQLite is sufficient for the current single-instance build and needs a persistent disk and backups. No hosting deployment is included in this phase.

Chat source files:

- `src/chat/agent.ts` — contextual extraction, follow-ups, multi-dish candidate generation, balanced price/rating ranking, and assistant streaming.
- `src/chat/store.ts` — SQLite browser sessions, preferences, conversations and messages.
- `public/` — chat interface, onboarding, cards, history and settings.

Chat APIs (scoped to the session cookie):

- `GET/PUT /api/profile` — preferences and selected address.
- `GET/POST /api/chats` — history and conversation creation.
- `GET/DELETE /api/chats/:id` — conversation retrieval/deletion.
- `POST /api/chats/:id/messages` — accepts `{ "message": "..." }`; streams SSE `status`, `delta`, and `done` events. The completed reply and cards are saved even if the browser disconnects.

## Swiggy integration

Live mode connects directly to **Swiggy's official Food MCP server**, `https://mcp.swiggy.com/food`, using `@modelcontextprotocol/sdk` and Streamable HTTP. There is no web scraping or separate localhost gateway.

The client performs MCP initialization, discovers tools (including paginated catalogues), preserves the MCP session, and calls tools with `tools/call`. It accepts Swiggy's `{ success, data }` envelope and direct tool payloads from MCP structured content or JSON text content. Authentication uses Swiggy's dynamic client registration and OAuth PKCE endpoints; tokens remain in server memory and require sign-in again after expiry/restart. Cart/order mutations are never automatically retried. Known read-only tools reconnect and retry once on HTTP 404 to recover an expired MCP session. HTTP 429 preserves the connection and starts a per-session cooldown using `Retry-After` (seconds or HTTP date), or an increasing precautionary delay starting at 60 seconds if absent/invalid. This is an earliest retry time, not a promise that Swiggy’s quota has reset. The UI shows a live-search pause countdown while leaving chat and preferences usable. A saved delivery address is reused on page load; opening the address picker explicitly loads the address list. Search failures preserve the parsed request so “Retry last search” keeps the dish and budget. Safe rate-limit diagnostics (operation, timestamp, retry-header availability and provider request ID when present) appear in local status/logs; no tokens or raw response bodies are included. calls are not automatically replayed when the cooldown ends. Other HTTP failures report the status and tool name without exposing upstream bodies. Saved addresses are cached for five minutes; searches and menus for one minute. Identical concurrent reads share one request, and caches are isolated per client and cleared on credential changes. Cached menu prices are refreshed at expiry and remain estimates.

The recommendation flow is:

1. Connect Swiggy in the browser.
2. Load saved addresses with `get_addresses`; choose one explicitly.
3. Call `search_restaurants` with the selected `addressId` and query.
4. Browse open restaurants using `get_restaurant_menu` with restaurant and address IDs. Both flat menus and paginated category menus are supported; duplicate item IDs are merged across categories.
5. Compare in-stock, priced items and return a recommendation.

Generating recommendations **does not update the cart or place an order**. Live recommendations skip cart-specific coupon requests. Low-level adapters for `get_food_cart`, `update_food_cart`, `fetch_food_coupons`, `place_food_order` and `track_food_order` exist, but checkout is disabled until a verified cart-review flow is implemented. The order adapter requires a confirmation flag; a future checkout flow must first show the actual cart, address, and available payment method to the user.

## Setup

Requires Node.js v24.21.0. With nvm installed, run `nvm install` and `nvm use` to select the version pinned in `.nvmrc`.

```bash
npm install
cp .env.example .env
npm run dev:web
```

Open **http://localhost:3000**. The default is demo mode (`USE_MOCK_MCP=true`), with sample restaurants and coupons. `OPENAI_API_KEY` is optional: without it, simple keyword extraction is used.

For live mode, set these values in `.env` and restart:

```dotenv
USE_MOCK_MCP=false
SWIGGY_MCP_URL=https://mcp.swiggy.com/food
SWIGGY_MCP_REDIRECT_URI=http://localhost:3000/api/mcp/auth/callback
```

Click **Connect Swiggy**, complete Swiggy's phone/OTP flow in its browser page, then choose a delivery address. No token needs to be pasted into the web UI.

If Swiggy says, “Local Application isn't whitelisted yet” or “This client isn't supported for Swiggy MCP sign-in yet”, that means Swiggy is rejecting the local dynamic registration flow. In that case, this project cannot complete browser sign-in with a blank or unapproved client ID. Set `SWIGGY_MCP_CLIENT_ID` to a Swiggy-approved public client, or ask Swiggy to whitelist your localhost app and redirect URI.

Swiggy must accept your **exact** redirect URI. If registration or authorization rejects the callback, follow the official authentication documentation to register/allowlist it. Use the same hostname when opening the app as in the redirect URI (`localhost` by default). Production access is managed by Swiggy; this repo does not provision it.

The deprecated `SWIGGY_MCP_BASE_URL` remains an optional origin fallback when `SWIGGY_MCP_URL` is absent. The obsolete `/tools/{name}/invoke` gateway contract and generic retry setting are no longer used.

### CLI

```bash
npm run dev
```

Live CLI mode requires a valid `SWIGGY_MCP_ACCESS_TOKEN` in the process environment or local `.env`. It lists saved addresses for selection. Browser tokens are in the web server's memory and are not shared with a separate CLI process. For browser authentication, use web mode.

### Checks

```bash
npm run check
npm test
npm run build
```

Tests use a local HTTP MCP fixture with JSON and SSE responses. They cover initialization, tool discovery and pagination, session headers, PKCE, authentication failures, response normalization, and mutation retry/confirmation behavior. They do not place real orders or establish an authenticated Swiggy session.

## API

- `GET /api/mcp/status` — demo/live mode and whether a token is available (not a live token-validity check).
- `POST /api/mcp/auth/start` — begin browser sign-in; returns `authorizeUrl` and sets an HTTP-only state cookie.
- `GET /api/mcp/auth/callback` — complete sign-in and return to the UI.
- `GET /api/mcp/tools` — authenticated tool catalogue and input schemas.
- `GET /api/addresses?page=1` — saved addresses; phone numbers are omitted.
- `POST /api/recommend` — accepts `query`, `addressId` (required in live mode), `budget`, `quantity` (1–6), `premium`, `dislikes`, `deliveryTimeWeight`.
- `GET /health` — local server health.

This is a **local development application** bound to `127.0.0.1`. The web chat isolates browser sessions and preferences; CLI preference history remains local. Public hosting requires app-account authentication and durable per-user credential handling.

## Pricing and recommendation limits

- Live prices are **menu-based estimates**, not verified checkout totals. Delivery charges, tax, packaging, variants/add-ons, and coupons are excluded. Responses mark this with `pricingIsEstimate: true`; `subtotal` and `finalPrice` retain their existing field names for compatibility. Final checkout can exceed the entered budget.
- Live coupon data is cart/restaurant-specific and does not provide the flat discount formula used by the demo optimizer. Demo coupons are never applied to live prices. Verified discounts require a future cart-review flow.
- The legacy recommendation API prioritizes estimated price in value mode; premium mode uses taste match, rating and delivery time. The chat ranks a balance of price and rating, with delivery-time refinements. Missing rating/time signals currently use zero internally.
- Search considers up to 10 restaurants and at most 10 category pages / 150 unique available items per restaurant. Individual categories can also be truncated by Swiggy. Combination enumeration is capped at 20,000 candidates per restaurant, ordered by item price; it is not an exhaustive optimum for large menus.
- Number of people currently means number of menu items; it does not infer serving sizes.
- The web chat maintains persistent conversational state. The CLI remains a single request interface.

## Code map

- `src/agent/` — intent/preferences and recommendation orchestration.
- `src/mcp/` — official MCP transport, OAuth and Food tool adapters.
- `src/recommendation/` — deterministic combinations, ranking and demo coupon arithmetic.
- `src/memory/` — SQLite preference storage.
- `src/web/`, `public/` — local API and browser UI.

## Official references

- [Swiggy Food tools](https://mcp.swiggy.com/builders/docs/reference/food/)
- [Authentication and redirect requirements](https://mcp.swiggy.com/builders/docs/start/authenticate/)
- [Saved delivery addresses](https://mcp.swiggy.com/builders/docs/reference/food/get_addresses/)
- [Restaurant search](https://mcp.swiggy.com/builders/docs/reference/food/search_restaurants/)
- [Restaurant menu schema](https://mcp.swiggy.com/builders/docs/reference/food/get_restaurant_menu/)

Live response formats can differ from the published reference. Adapter validation errors identify the tool and field that failed, without including account details.
