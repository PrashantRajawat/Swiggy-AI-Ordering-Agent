# Swiggy AI Ordering Agent

A personal food recommendation app with a CLI and a small web UI. It extracts preferences from natural language, searches menus, and compares item combinations within a budget.

## Swiggy integration

Live mode connects directly to **Swiggy's official Food MCP server**, `https://mcp.swiggy.com/food`, using `@modelcontextprotocol/sdk` and Streamable HTTP. There is no web scraping or separate localhost gateway.

The client performs MCP initialization, discovers tools (including paginated catalogues), preserves the MCP session, and calls tools with `tools/call`. It accepts Swiggy's `{ success, data }` envelope and direct tool payloads from MCP structured content or JSON text content. Authentication uses Swiggy's dynamic client registration and OAuth PKCE endpoints; tokens remain in server memory and require sign-in again after expiry/restart. Tool calls are not automatically retried, to avoid duplicate mutations.

The recommendation flow is:

1. Connect Swiggy in the browser.
2. Load saved addresses with `get_addresses`; choose one explicitly.
3. Call `search_restaurants` with the selected `addressId` and query.
4. Browse open restaurants using `get_restaurant_menu` with restaurant and address IDs. Both flat menus and paginated category menus are supported; duplicate item IDs are merged across categories.
5. Compare in-stock, priced items and return a recommendation.

Generating recommendations **does not update the cart or place an order**. Low-level adapters for `get_food_cart`, `update_food_cart`, `fetch_food_coupons`, `place_food_order` and `track_food_order` exist, but checkout is not connected to a UI/API route. The order adapter requires a confirmation flag; a future checkout flow must first show the actual cart, address, and available payment method to the user.

## Setup

Requires Node.js 18.20+ (a supported LTS release is recommended).

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

Click **Connect Swiggy**, complete Swiggy's phone/OTP flow in its browser page, then choose a delivery address. No token needs to be pasted into the web UI. `SWIGGY_MCP_CLIENT_ID` can be left blank for dynamic registration, or set to an existing registered public client.

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

This is a **single-user local application**. It binds to `127.0.0.1`, holds one Swiggy account in memory, and stores one preference history in SQLite. A hosted/multi-user deployment would need per-user authentication, token isolation, and preference storage.

## Pricing and recommendation limits

- Live prices are **menu-based estimates**, not verified checkout totals. Delivery charges, tax, packaging, variants/add-ons, and coupons are excluded. Responses mark this with `pricingIsEstimate: true`; `subtotal` and `finalPrice` retain their existing field names for compatibility. Final checkout can exceed the entered budget.
- Live coupon data is cart/restaurant-specific and does not provide the flat discount formula used by the demo optimizer. Demo coupons are never applied to live prices. Verified discounts require a future cart-review flow.
- Value mode prioritizes estimated price; premium mode uses taste match, rating and delivery time. Missing rating/time signals currently use zero internally.
- Search considers up to 10 restaurants and at most 10 category pages / 150 unique available items per restaurant. Individual categories can also be truncated by Swiggy. Combination enumeration is capped at 20,000 candidates per restaurant, ordered by item price; it is not an exhaustive optimum for large menus.
- Number of people currently means number of menu items; it does not infer serving sizes.
- Follow-up question generation exists, but neither interface maintains a full conversational session. Explanations are currently templates.

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
