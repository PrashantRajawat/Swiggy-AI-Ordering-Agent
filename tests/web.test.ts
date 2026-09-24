import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

test("web demo returns recommendations without Swiggy access and validates input", async () => {
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const dir = await mkdtemp(path.join(tmpdir(), "swiggy-web-test-"));
  const child = spawn(process.execPath, ["--import", "tsx", "src/web/server.ts"], {
    env: { ...process.env, PORT: String(port), USE_MOCK_MCP: "true", OPENAI_API_KEY: "", SQLITE_DB_PATH: path.join(dir, "test.db"), SWIGGY_MCP_URL: "http://127.0.0.1:1/food" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });
  try {
    const base = `http://127.0.0.1:${port}`;
    let started = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (child.exitCode !== null) throw new Error(logs);
      try { if ((await fetch(`${base}/health`)).ok) { started = true; break; } } catch { /* starting */ }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(started, logs);
    assert.deepEqual(await (await fetch(`${base}/api/mcp/status`)).json(), { mode: "mock", authenticated: false });
    const payload = { query: "chocolate waffles", budget: 500, quantity: 2, premium: false, dislikes: [] };
    const recommend = (body: unknown) => fetch(`${base}/api/recommend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const response = await recommend(payload);
    assert.equal(response.status, 200);
    const result = await response.json() as any;
    assert.equal(result.status, "ready");
    assert.equal(result.recommendation.items.length, 2);
    assert.ok(Array.isArray(result.recommendations));
    assert.ok(result.recommendations.length >= 1);
    assert.ok(result.recommendations.every((item: any) => Array.isArray(item.items)));
    assert.ok(result.recommendation.finalPrice <= 500);
    assert.equal(result.recommendation.pricingIsEstimate, false);
    assert.equal((await recommend({ ...payload, quantity: 1.5 })).status, 400);
    assert.equal((await recommend({ ...payload, quantity: 100 })).status, 400);
    assert.equal((await recommend({ ...payload, query: "" })).status, 400);
    assert.equal((await fetch(`${base}/api/addresses?page=-1`)).status, 400);
    assert.equal((await fetch(`${base}/api/mcp/auth/start`)).status, 404);
    assert.equal((await fetch(`${base}/api/recommend`, { method: "POST", headers: { Origin: "https://unrelated.example" } })).status, 403);
    assert.equal((await fetch(`${base}/`)).status, 200);
  } finally {
    if (child.exitCode === null) {
      const stopped = once(child, "exit");
      child.kill("SIGTERM");
      await stopped;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
