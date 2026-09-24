import "dotenv/config";
import path from "node:path";
import express from "express";
import { z } from "zod";
import { AgentOrchestrator } from "../agent/orchestrator";
import { mcpClient } from "../mcp/runtime";
import { SwiggyAuthError } from "../mcp/client";
import { AddressMcpService } from "../mcp/address";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const orchestrator = new AgentOrchestrator();
const addresses = new AddressMcpService(mcpClient);

// This app holds one personal Swiggy account in memory; serve it on loopback only.
app.use((req, res, next) => {
  const hosts = [`localhost:${port}`, `127.0.0.1:${port}`];
  if (!hosts.includes(req.headers.host ?? "")) {
    res.status(403).json({ error: "Open this app through localhost." });
    return;
  }
  const origin = req.headers.origin;
  if (origin && !hosts.some((host) => origin === `http://${host}`)) {
    res.status(403).json({ error: "Requests must come from this app." });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use(express.json({ limit: "16kb" }));
app.use(express.static(path.resolve(process.cwd(), "public")));

function sendError(res: express.Response, error: unknown): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: `Invalid request fields: ${error.issues.map((issue) => issue.path.join(".") || "request").join(", ")}.` });
  } else {
    res.status(error instanceof SwiggyAuthError ? 401 : 502).json({
      error: error instanceof Error ? error.message : "The request could not be completed.",
    });
  }
}

app.get("/api/mcp/status", (_req, res) => res.json(mcpClient.getStatus()));

app.post("/api/mcp/auth/start", async (_req, res) => {
  try {
    const { authorizeUrl, state } = await mcpClient.startAuthorization();
    res.cookie("swiggy_oauth_state", state, { httpOnly: true, sameSite: "lax", maxAge: 600_000, path: "/api/mcp/auth/callback" });
    res.json({ authorizeUrl });
  } catch (error) { sendError(res, error); }
});

app.get("/api/mcp/auth/callback", async (req, res) => {
  try {
    const { code, state } = z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(req.query);
    const cookieState = req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("swiggy_oauth_state="))?.slice("swiggy_oauth_state=".length);
    if (state !== cookieState) throw new Error("Authorization browser session does not match. Connect Swiggy again.");
    res.clearCookie("swiggy_oauth_state", { path: "/api/mcp/auth/callback" });
    await mcpClient.completeAuthorization(code, state);
    res.redirect("/?connected=1");
  } catch (error) { sendError(res, error); }
});

app.get("/api/mcp/tools", async (_req, res) => {
  try { res.json({ tools: await mcpClient.listTools() }); }
  catch (error) { sendError(res, error); }
});

app.get("/api/addresses", async (req, res) => {
  try {
    const page = z.coerce.number().int().min(1).max(100).parse(req.query.page ?? 1);
    res.json(await addresses.getAddresses(page));
  } catch (error) { sendError(res, error); }
});

const recommendSchema = z.object({
  query: z.string().trim().min(1).max(500),
  addressId: z.string().min(1).optional(),
  budget: z.number().positive().max(100000).optional(),
  quantity: z.number().int().min(1).max(6).optional(),
  premium: z.boolean().optional(),
  dislikes: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  deliveryTimeWeight: z.number().min(0).max(10).optional(),
});

app.post("/api/recommend", async (req, res) => {
  try {
    const { query, addressId, ...preferences } = recommendSchema.parse(req.body);
    res.json(await orchestrator.handleRequest({ message: query, addressId, preferences }));
  } catch (error) { sendError(res, error); }
});

app.get("/health", (_req, res) => res.json({ ok: true }));
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Swiggy AI web UI running on http://localhost:${port}`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close();
    void mcpClient.close().finally(() => process.exit(0));
  });
}
