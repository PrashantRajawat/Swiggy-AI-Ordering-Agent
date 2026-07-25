import { createHash, randomBytes } from "node:crypto";
import { logger } from "../utils/logger";

interface SwiggyMcpConfig {
  baseUrl: string;
  accessToken?: string;
  clientId?: string;
  redirectUri?: string;
  timeoutMs: number;
  retries: number;
  useMock: boolean;
}

interface OAuthSession {
  state: string;
  codeVerifier: string;
  createdAt: number;
}

const oauthSessions = new Map<string, OAuthSession>();

function base64UrlSha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export class SwiggyMcpClient {
  private config: SwiggyMcpConfig;

  constructor() {
    this.config = {
      baseUrl: process.env.SWIGGY_MCP_BASE_URL ?? "http://localhost:8787",
      accessToken: process.env.SWIGGY_MCP_ACCESS_TOKEN,
      clientId: process.env.SWIGGY_MCP_CLIENT_ID,
      redirectUri: process.env.SWIGGY_MCP_REDIRECT_URI,
      timeoutMs: Number(process.env.SWIGGY_MCP_TIMEOUT_MS ?? 12000),
      retries: Number(process.env.SWIGGY_MCP_RETRIES ?? 2),
      useMock: (process.env.USE_MOCK_MCP ?? "true").toLowerCase() === "true",
    };
  }

  isMockMode(): boolean {
    return this.config.useMock;
  }

  setAccessToken(token: string): void {
    this.config.accessToken = token;
  }

  hasAccessToken(): boolean {
    return Boolean(this.config.accessToken);
  }

  startAuthorization(scope = "mcp:tools mcp:resources mcp:prompts"): { authorizeUrl: string; state: string } {
    if (!this.config.clientId || !this.config.redirectUri) {
      throw new Error("Missing SWIGGY_MCP_CLIENT_ID or SWIGGY_MCP_REDIRECT_URI");
    }

    const state = randomBytes(16).toString("hex");
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = base64UrlSha256(codeVerifier);

    oauthSessions.set(state, {
      state,
      codeVerifier,
      createdAt: Date.now(),
    });

    const url = new URL("/auth/authorize", this.config.baseUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("scope", scope);

    return { authorizeUrl: url.toString(), state };
  }

  async completeAuthorization(code: string, state: string): Promise<{ accessToken: string; expiresIn: number }> {
    const session = oauthSessions.get(state);
    if (!session) {
      throw new Error("Invalid or expired OAuth state");
    }
    oauthSessions.delete(state);

    if (!this.config.redirectUri) {
      throw new Error("Missing SWIGGY_MCP_REDIRECT_URI");
    }

    const tokenUrl = new URL("/auth/token", this.config.baseUrl).toString();
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        code_verifier: session.codeVerifier,
        redirect_uri: this.config.redirectUri,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Token exchange failed: HTTP ${response.status} ${detail}`);
    }

    const tokenData = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };

    if (!tokenData.access_token) {
      throw new Error("Token exchange succeeded but access_token is missing");
    }

    this.setAccessToken(tokenData.access_token);
    return {
      accessToken: tokenData.access_token,
      expiresIn: tokenData.expires_in ?? 0,
    };
  }

  async invokeTool<T>(
    toolName: string,
    input: Record<string, unknown>,
    mockHandler: () => Promise<T> | T,
  ): Promise<T> {
    if (this.config.useMock) {
      return Promise.resolve(mockHandler());
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.config.retries + 1; attempt += 1) {
      try {
        return await this.invokeRemoteTool<T>(toolName, input);
      } catch (error) {
        lastError = error;
        logger.warn("MCP tool call failed", { toolName, attempt, error: String(error) });
      }
    }

    throw new Error(`MCP tool '${toolName}' failed after retries: ${String(lastError)}`);
  }

  private async invokeRemoteTool<T>(toolName: string, input: Record<string, unknown>): Promise<T> {
    if (!this.config.accessToken) {
      throw new Error("No MCP access token. Run authorization flow first.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.baseUrl}/tools/${toolName}/invoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.accessToken}`,
        },
        body: JSON.stringify({ input }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`HTTP ${response.status} for ${toolName}: ${detail}`);
      }

      const payload = (await response.json()) as { output?: T };
      if (payload.output === undefined) {
        throw new Error(`Invalid MCP payload for tool ${toolName}`);
      }
      return payload.output;
    } finally {
      clearTimeout(timeout);
    }
  }
}
