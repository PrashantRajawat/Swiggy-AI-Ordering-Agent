# Swiggy AI Ordering Agent

Personal AI agent that finds best food combinations on Swiggy using natural language, MCP tool calls, deterministic optimization, and coupon-aware ranking.

## Current Scope

This scaffold implements:

- TypeScript backend architecture
- OpenAI-powered intent parsing and follow-up question generation
- CLI chat flow
- Minimal web UI + API
- Swiggy MCP client + service layer
- Tool Orchestrator for MCP tool routing
- Mock MCP provider for local development
- Combination generation + ranking + coupon evaluation hooks
- SQLite preference memory

## Tech

- Node.js + TypeScript
- Model Context Protocol (MCP) integration layer
- OpenAI API
- SQLite (`better-sqlite3`)
- Express (minimal web UI backend)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment file:

```bash
cp .env.example .env
```

3. Add `OPENAI_API_KEY` in `.env`.

4. Configure MCP variables in `.env`.

## Run

CLI mode:

```bash
npm run dev
```

Web mode:

```bash
npm run dev:web
```

Then open `http://localhost:3000`.

## Notes

- By default `USE_MOCK_MCP=true` to avoid accidental live order actions while developing.
- The app never places orders automatically. Order placement requires explicit confirmation.
- LLM is used only for intent understanding, follow-up questions, and recommendation explanation. Pricing/ranking/discount logic stays deterministic.

## MCP Mode

Set these in `.env` to use MCP tools:

```bash
SWIGGY_MCP_BASE_URL=http://localhost:8787
SWIGGY_MCP_CLIENT_ID=
SWIGGY_MCP_REDIRECT_URI=http://localhost:3000/api/mcp/auth/callback
SWIGGY_MCP_ACCESS_TOKEN=
SWIGGY_MCP_TIMEOUT_MS=12000
SWIGGY_MCP_RETRIES=2
USE_MOCK_MCP=true
SWIGGY_MCP_MAX_RESTAURANTS=10
```

For live MCP calls (`USE_MOCK_MCP=false`), authenticate first (OAuth 2.1 + PKCE):

1. Start auth and copy `authorizeUrl`:

```bash
curl http://localhost:3000/api/mcp/auth/start
```

2. Open `authorizeUrl` in browser, complete phone + OTP.

3. Swiggy redirects to `/api/mcp/auth/callback` and the server stores bearer token in memory.

When `USE_MOCK_MCP=false`, the app calls MCP tools such as:

- `search_restaurants`
- `search_menu`
- `get_menu`
- `get_restaurant_details`
- `update_cart`
- `get_cart`
- `apply_available_offers`
- `place_order`
- `track_order`

## Phase Mapping

- Phase 1: wired (chat, MCP abstraction, structured JSON output)
- Phase 2: core recommendation logic wired and extendable
- Phase 3: cart/offers MCP interface and mock evaluation wired
- Phase 4: OpenAI NLU + follow-up question generation + memory
- Phase 5: order placement kept confirmation-gated
