import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { z } from "zod";

export interface SwiggyMcpConfig {
  endpoint: string;
  accessToken?: string;
  clientId?: string;
  redirectUri: string;
  timeoutMs: number;
  useMock: boolean;
}

export class SwiggyAuthError extends Error {}

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
  getStatus(): { mode: "mock" | "live"; authenticated: boolean } {
    return { mode: this.isMockMode() ? "mock" : "live", authenticated: this.hasAccessToken() };
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
    if (!response.ok) throw new Error(`Swiggy authorization failed (HTTP ${response.status}). Check the registered redirect URI.`);
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

  private async authenticated<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (error instanceof UnauthorizedError || (error instanceof StreamableHTTPError && [401, 419].includes(error.code ?? 0))) {
        this.config.accessToken = undefined;
        await this.close();
        throw new SwiggyAuthError("Your Swiggy session expired. Connect Swiggy again.");
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
    // No automatic retries: cart/order tools can have non-idempotent side effects.
    return this.authenticated(async () => {
      const client = await this.connect();
      if (!this.toolCatalog.some((tool) => tool.name === name)) throw new Error(`Swiggy does not currently advertise the ${name} tool.`);
      const result = await client.callTool({ name, arguments: input }, undefined, { timeout: this.config.timeoutMs });
      return decodeToolResult(result) as T;
    });
  }
}
