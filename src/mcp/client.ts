import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { z } from "zod";
import { logger } from "../utils/logger";

export interface SwiggyMcpConfig {
  endpoint: string;
  accessToken?: string;
  clientId?: string;
  redirectUri: string;
  timeoutMs: number;
  useMock: boolean;
}

export class SwiggyAuthError extends Error {}

export class SwiggyTransportError extends Error {
  constructor(readonly status: number | undefined, readonly operation: string) {
    const code = status && status > 0 ? ` (HTTP ${status})` : "";
    const advice = status === 403 ? "Swiggy denied access. Reconnect your account; if this persists, check the app’s MCP permissions."
      : status === 404 ? "The MCP session or endpoint was not found. Try again to establish a new session."
      : status === 429 ? "Swiggy is limiting requests. Wait a moment before trying again."
      : status && status >= 500 ? "Swiggy is temporarily unavailable. Please try again shortly."
      : status === 400 ? "Swiggy rejected the request. Try again; if this persists, the tool’s input requirements may have changed."
      : "Check your connection and try again.";
    super(`Swiggy could not complete ${operation}${code}. ${advice}`);
    this.name = "SwiggyTransportError";
  }
}
export class SwiggyRateLimitError extends SwiggyTransportError {
  constructor(readonly retryAt: number, operation: string, readonly source: "upstream" | "local_cooldown" = "local_cooldown", resetProvided = false) {
    super(429, operation);
    this.name = "SwiggyRateLimitError";
    this.message = `${source === "upstream" ? "Swiggy rejected the live request (HTTP 429)." : "Live requests are paused after Swiggy returned HTTP 429."} ${resetProvided ? "Swiggy supplied a minimum retry delay." : "Swiggy did not provide a usable reset time; the app is pausing requests as a precaution."} Earliest retry in ${Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))} seconds; recovery is not guaranteed. Your account is still connected. You can continue chatting or update preferences.`;
  }
}
const CACHE_TTLS: Record<string, number> = { get_addresses: 300000, search_restaurants: 60000, get_restaurant_menu: 60000 };
const READ_ONLY_TOOLS = new Set(["get_addresses", "search_restaurants", "get_restaurant_menu", "get_food_cart", "fetch_food_coupons", "track_food_order"]);

// Swiggy returns its envelope inside MCP structuredContent or JSON text content.
export function decodeToolResult(raw: unknown): unknown {
  const result = z.object({
    isError: z.boolean().optional(),
    structuredContent: z.record(z.unknown()).optional(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  }).parse(raw);
  if (result.isError) throw new Error("Swiggy could not complete the tool call. Please try again.");
  let payload: unknown = result.structuredContent;
  if (payload === undefined) {
    for (const block of result.content ?? []) {
      if (block.type !== "text" || !block.text) continue;
      try { payload = JSON.parse(block.text); break; } catch { /* skip display text */ }
    }
  }
  // Some deployments return the tool payload directly rather than the
  // success/data envelope documented by Swiggy. Tool adapters validate it.
  for (let depth = 0; depth < 4; depth += 1) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") break;
    const object = payload as Record<string, unknown>;
    if (object.success === false || object.isError === true || object.error != null) {
      throw new Error("Swiggy reported a tool error. Please retry or reconnect your account.");
    }
    if ("data" in object && ("success" in object || Object.keys(object).every((key) => ["data", "message", "status"].includes(key)))) {
      if (object.data == null) throw new Error("Swiggy returned no tool data.");
      payload = object.data;
      continue;
    }
    if (Object.keys(object).length === 1 && "result" in object) {
      payload = object.result;
      continue;
    }
    if (object.success === true) throw new Error("Swiggy returned no tool data.");
    return object;
  }
  throw new Error("Swiggy returned an unsupported response shape (no JSON tool data).");
}

export class SwiggyMcpClient {
  private readonly config: SwiggyMcpConfig;
  private client?: Client;
  private connection?: Promise<Client>;
  private toolCatalog: Array<{ name: string; inputSchema: unknown }> = [];
  private expiresAt?: number;
  private retryAt = 0;
  private rateLimit?: { operation: string; receivedAt: number; consecutive: number; retryAfterProvided: boolean; requestId?: string };
  private readonly cache = new Map<string, { expires: number; value: unknown }>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  getRetryAt(): number | undefined { return this.retryAt > Date.now() ? this.retryAt : undefined; }
  private checkCooldown(operation: string): void {
    if (this.getRetryAt()) throw new SwiggyRateLimitError(this.retryAt, operation, "local_cooldown", this.rateLimit?.retryAfterProvided);
  }
  private readonly oauthSessions = new Map<string, { verifier: string; createdAt: number }>();

  constructor(config: Partial<SwiggyMcpConfig> = {}) {
    this.config = {
      endpoint: process.env.SWIGGY_MCP_URL ?? new URL("/food", process.env.SWIGGY_MCP_BASE_URL || "https://mcp.swiggy.com").toString(),
      accessToken: process.env.SWIGGY_MCP_ACCESS_TOKEN || undefined,
      clientId: process.env.SWIGGY_MCP_CLIENT_ID || undefined,
      redirectUri: process.env.SWIGGY_MCP_REDIRECT_URI || "http://localhost:3000/api/mcp/auth/callback",
      timeoutMs: Number(process.env.SWIGGY_MCP_TIMEOUT_MS ?? 15000),
      useMock: (process.env.USE_MOCK_MCP ?? "true").toLowerCase() === "true",
      ...config,
    };
    const url = new URL(this.config.endpoint);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
      throw new Error("Swiggy MCP requires HTTPS (HTTP is allowed only for localhost development).");
    }
  }

  isMockMode(): boolean { return this.config.useMock; }
  hasAccessToken(): boolean {
    return Boolean(this.config.accessToken) && (!this.expiresAt || Date.now() < this.expiresAt);
  }
  getStatus(): { mode: "mock" | "live"; authenticated: boolean; retryAt?: number; rateLimit?: { operation: string; receivedAt: number; consecutive: number; retryAfterProvided: boolean; requestId?: string } } {
    return { mode: this.isMockMode() ? "mock" : "live", authenticated: this.hasAccessToken(), ...(this.getRetryAt() ? { retryAt: this.retryAt } : {}), ...(this.rateLimit ? { rateLimit: this.rateLimit } : {}) };
  }

  async close(): Promise<void> {
    const pending = this.connection;
    this.connection = undefined;
    const client = this.client ?? await pending?.catch(() => undefined);
    this.client = undefined;
    this.toolCatalog = [];
    await client?.close();
  }

  async setAccessToken(token: string, expiresIn?: number): Promise<void> {
    await this.close();
    this.cache.clear();
    this.inFlight.clear();
    this.config.accessToken = token;
    this.expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : undefined;
  }

  private async authPost(path: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(new URL(path, this.config.endpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
      redirect: "error",
    });
    if (!response.ok) {
      let detail = "";
      try {
        const payload = await response.clone().json() as Record<string, unknown>;
        const errorText = typeof payload.error_description === "string" ? payload.error_description
          : typeof payload.error === "string" ? payload.error
          : typeof payload.message === "string" ? payload.message
          : "";
        if (errorText) detail = `: ${errorText}`;
      } catch {
        // Swiggy may return a non-JSON error body or a generic HTML page.
      }
      if (path === "/auth/register") {
        throw new Error(
          `Swiggy rejected local client registration${detail}. This app is not whitelisted for local OAuth sign-in yet. Use a Swiggy-approved client ID in SWIGGY_MCP_CLIENT_ID or ask Swiggy to allow this localhost redirect URI.`,
        );
      }
      throw new Error(`Swiggy authorization failed (HTTP ${response.status})${detail}. Check the registered redirect URI and client ID.`);
    }
    return response.json();
  }

  async startAuthorization(): Promise<{ authorizeUrl: string; state: string }> {
    if (this.isMockMode()) throw new Error("Set USE_MOCK_MCP=false and restart before connecting Swiggy.");
    if (!this.config.clientId) {
      const registration = z.object({ client_id: z.string().min(1) }).parse(await this.authPost("/auth/register", {
        client_name: "Swiggy AI Ordering Agent",
        redirect_uris: [this.config.redirectUri],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }));
      this.config.clientId = registration.client_id;
    }
    for (const [state, session] of this.oauthSessions) {
      if (Date.now() - session.createdAt > 600_000) this.oauthSessions.delete(state);
    }
    const state = randomBytes(32).toString("hex");
    const verifier = randomBytes(32).toString("base64url");
    this.oauthSessions.set(state, { verifier, createdAt: Date.now() });
    const url = new URL("/auth/authorize", this.config.endpoint);
    url.search = new URLSearchParams({
      response_type: "code", client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri, state, scope: "mcp:tools",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    return { authorizeUrl: url.toString(), state };
  }

  async completeAuthorization(code: string, state: string): Promise<{ expiresIn: number }> {
    const session = this.oauthSessions.get(state);
    this.oauthSessions.delete(state);
    if (!session || Date.now() - session.createdAt > 600_000) throw new Error("Invalid or expired authorization state. Connect Swiggy again.");
    const token = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() }).parse(
      await this.authPost("/auth/token", {
        grant_type: "authorization_code", code, code_verifier: session.verifier,
        client_id: this.config.clientId, redirect_uri: this.config.redirectUri,
      }),
    );
    await this.setAccessToken(token.access_token, token.expires_in);
    return { expiresIn: token.expires_in };
  }

  private async connect(): Promise<Client> {
    if (!this.hasAccessToken()) throw new SwiggyAuthError("Connect your Swiggy account first. Your session may have expired.");
    if (!this.connection) {
      this.connection = (async () => {
        const client = new Client({ name: "swiggy-ai-ordering-agent", version: "0.1.0" });
        const transport = new StreamableHTTPClientTransport(new URL(this.config.endpoint), {
          requestInit: { headers: { Authorization: `Bearer ${this.config.accessToken}` } },
          fetch: async (url, init) => {
            this.checkCooldown("MCP request");
            const response = await fetch(url, init);
            if (response.status === 429) {
              const header = response.headers.get("retry-after");
              const seconds = header && /^\d+(?:\.\d+)?$/.test(header.trim()) ? Number(header) : NaN;
              const until = Number.isFinite(seconds) ? Date.now() + Math.max(1, seconds) * 1000 : header ? Date.parse(header) : NaN;
              const provided = Number.isFinite(until) && until > Date.now();
              const consecutive = (this.rateLimit?.consecutive ?? 0) + 1;
              this.retryAt = Math.max(this.retryAt, provided ? until : Date.now() + Math.min(900000, 60000 * 2 ** Math.min(4, consecutive - 1)));
              let operation = init?.method || "MCP request";
              try {
                const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
                operation = body?.method === "tools/call" ? String(body.params?.name) : body?.method || operation;
              } catch { /* Only retain the operation, never arguments or raw bodies. */ }
              const reference = response.headers.get("x-request-id");
              this.rateLimit = { operation, receivedAt: Date.now(), consecutive, retryAfterProvided: provided,
                ...(reference && /^[a-zA-Z0-9_.:-]{1,160}$/.test(reference) ? { requestId: reference } : {}) };
              logger.warn("Swiggy gateway returned HTTP 429", { ...this.rateLimit, retryAt: this.retryAt });
            } else if (response.ok && init?.method === "POST") {
              this.rateLimit = undefined;
            }
            return response;
          },
        });
        try {
          await client.connect(transport, { timeout: this.config.timeoutMs });
          const catalog: Array<{ name: string; inputSchema: unknown }> = [];
          let cursor: string | undefined;
          do {
            const page = await client.listTools(cursor ? { cursor } : {}, { timeout: this.config.timeoutMs });
            catalog.push(...page.tools.map(({ name, inputSchema }) => ({ name, inputSchema })));
            cursor = page.nextCursor;
          } while (cursor);
          this.toolCatalog = catalog;
          this.client = client;
          return client;
        } catch (error) {
          await transport.close();
          throw error;
        }
      })();
    }
    try { return await this.connection; }
    catch (error) { this.connection = undefined; throw error; }
  }

  private async authenticated<T>(operation: () => Promise<T>, label = "MCP connection"): Promise<T> {
    this.checkCooldown(label);
    try { return await operation(); }
    catch (error) {
      if (error instanceof UnauthorizedError || (error instanceof StreamableHTTPError && [401, 419].includes(error.code ?? 0))) {
        this.config.accessToken = undefined;
        this.cache.clear();
        await this.close().catch(() => undefined);
        throw new SwiggyAuthError("Your Swiggy session expired. Connect Swiggy again.");
      }
      if (error instanceof StreamableHTTPError || error instanceof TypeError && /fetch failed/i.test(error.message)) {
        const status = error instanceof StreamableHTTPError ? error.code : undefined;
        // Do not log upstream bodies, headers or arguments: they can contain account data.
        logger.warn("Swiggy MCP transport request failed", { operation: label, status });
        if (status === 429) {
          // Keep the authenticated transport: reconnecting would add more requests.
          this.retryAt = Math.max(this.retryAt, Date.now() + 1000);
          throw new SwiggyRateLimitError(this.retryAt, label, "upstream", this.rateLimit?.retryAfterProvided);
        }
        await this.close().catch(() => undefined);
        throw new SwiggyTransportError(status, label);
      }
      throw error;
    }
  }

  async listTools(): Promise<Array<{ name: string; inputSchema: unknown }>> {
    if (this.isMockMode()) return [];
    return this.authenticated(async () => {
      await this.connect();
      return this.toolCatalog;
    });
  }

  async invokeTool<T>(name: string, input: Record<string, unknown>, mockHandler: () => Promise<T> | T): Promise<T> {
    if (this.isMockMode()) return mockHandler();
    const ttl = CACHE_TTLS[name];
    const key = JSON.stringify([name, input]);
    if (ttl) {
      const cached = this.cache.get(key);
      if (cached && cached.expires > Date.now() && this.hasAccessToken()) return structuredClone(cached.value) as T;
      if (this.inFlight.has(key)) return structuredClone(await this.inFlight.get(key)) as T;
    }
    const operation = this.authenticated(async () => {
      const call = async () => {
        const client = await this.connect();
        if (!this.toolCatalog.some((tool) => tool.name === name)) throw new Error(`Swiggy does not currently advertise the ${name} tool.`);
        return client.callTool({ name, arguments: input }, undefined, { timeout: this.config.timeoutMs });
      };
      let result;
      try { result = await call(); }
      catch (error) {
        // A server can expire its MCP session while the OAuth token remains valid.
        // Reinitialize once for known read operations; never replay a cart/order mutation.
        if (!(error instanceof StreamableHTTPError && error.code === 404 && READ_ONLY_TOOLS.has(name))) throw error;
        await this.close().catch(() => undefined);
        result = await call();
      }
      return decodeToolResult(result) as T;
    }, name);
    if (!ttl) return operation;
    this.inFlight.set(key, operation);
    try {
      const value = await operation;
      // Bound cached menu/account data to this client and a short lifetime.
      for (const [cacheKey, entry] of this.cache) if (entry.expires <= Date.now()) this.cache.delete(cacheKey);
      if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { expires: Date.now() + ttl, value: structuredClone(value) });
      return structuredClone(value);
    } finally { this.inFlight.delete(key); }
  }
}
