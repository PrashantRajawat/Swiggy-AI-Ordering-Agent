import "dotenv/config";
import path from "node:path";
import express from "express";
import { AgentOrchestrator } from "../agent/orchestrator";
import { mcpClient } from "../mcp/runtime";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const orchestrator = new AgentOrchestrator();

app.use(express.json());
app.use(express.static(path.resolve(process.cwd(), "public")));

app.get("/api/mcp/auth/start", (_req, res) => {
  try {
    const { authorizeUrl, state } = mcpClient.startAuthorization();
    res.json({ authorizeUrl, state });
  } catch (error) {
    res.status(400).json({ error: "Failed to start MCP authorization", detail: String(error) });
  }
});

app.get("/api/mcp/auth/callback", async (req, res) => {
  try {
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");
    if (!code || !state) {
      res.status(400).json({ error: "Missing code or state in callback" });
      return;
    }

    const token = await mcpClient.completeAuthorization(code, state);
    res.json({
      ok: true,
      expiresIn: token.expiresIn,
      message: "MCP authorization completed. You can now call recommendation APIs.",
    });
  } catch (error) {
    res.status(400).json({ error: "Failed to complete MCP authorization", detail: String(error) });
  }
});

app.post("/api/recommend", async (req, res) => {
  try {
    const { query, budget, quantity, premium, dislikes, deliveryTimeWeight } = req.body as {
      query: string;
      budget?: number;
      quantity?: number;
      premium?: boolean;
      dislikes?: string[];
      deliveryTimeWeight?: number;
    };

    const response = await orchestrator.handleRequest({
      message: query,
      preferences: {
        budget,
        quantity,
        premium,
        dislikes,
        deliveryTimeWeight,
      },
    });

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: "Failed to generate recommendation", detail: String(error) });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Swiggy AI web UI running on http://localhost:${port}`);
});
