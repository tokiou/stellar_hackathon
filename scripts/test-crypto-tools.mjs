#!/usr/bin/env node
// Quick test of the Compass proxy with crypto tools
import { spawn } from "node:child_process";
import { once } from "node:events";

let nextId = 1;

function sendRequest(proc, method, params = {}) {
  const id = nextId++;
  const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
  proc.stdin.write(msg);
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      try {
        const lines = chunk.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          const resp = JSON.parse(line);
          if (resp.id === id) {
            proc.stdout.off("data", onData);
            resolve(resp);
          }
        }
      } catch {}
    };
    proc.stdout.on("data", onData);
    setTimeout(() => { proc.stdout.off("data", onData); reject(new Error(`timeout for ${method}`)); }, 10000);
  });
}

async function runTests(label, cmd, args, env) {
  console.log(`\n--- ${label} ---`);
  const proc = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], cwd: process.cwd(), env: env ?? process.env });
  const stderrChunks = [];
  proc.stderr.on("data", (c) => stderrChunks.push(c.toString()));
  try {
    await sendRequest(proc, "initialize", {
      protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0.0.0" },
    });
    console.log("  initialize: ok");
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

    const list = await sendRequest(proc, "tools/list");
    const tools = list.result?.tools?.map((t) => t.name) ?? [];
    console.log(`  tools: [${tools.join(", ")}]`);

    const tests = [
      { name: "getPortfolioBalance", args: {} },
      { name: "getTokenPrice", args: { token: "BTC" } },
      { name: "sendToken", args: { token: "USDC", amount: 10, toAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" } },
      { name: "swapToken", args: { fromToken: "SOL", toToken: "USDC", amount: 2 } },
      { name: "createOrder", args: { pair: "BTC-USD", side: "BUY", size: 0.001 } },
    ];

    for (const t of tests) {
      try {
        const res = await sendRequest(proc, "tools/call", { name: t.name, arguments: t.args });
        const text = res.result?.content?.[0]?.text ?? JSON.stringify(res);
        const parsed = typeof text === "string" ? (() => { try { return JSON.parse(text); } catch { return text; } })() : text;
        const outcome = parsed?.outcome ?? parsed?.decision ?? "allow";
        const reason = parsed?.reason ?? parsed?.rationale ?? "";
        console.log(`  ${t.name.padEnd(20)} → ${outcome}${reason ? " (" + reason.slice(0, 80) + ")" : ""}`);
      } catch (e) {
        console.log(`  ${t.name.padEnd(20)} → ERROR: ${e.message}`);
      }
    }
  } finally {
    proc.kill();
    await once(proc, "close").catch(() => {});
    const stderr = stderrChunks.join("").trim();
    if (stderr) {
      const lines = stderr.split("\n").filter((l) => l.includes("compass:") || l.includes("[compass"));
      if (lines.length) console.log("  [compass]:", lines.join("\n  "));
    }
  }
}

await runTests(
  "Compass proxy with crypto tools",
  "npx", ["-y", "tsx", "back/services/mcp/server/mcpServer.ts"],
  { ...process.env, COMPASS_MCP_DOWNSTREAM_CONFIG: JSON.stringify({ name: "test", command: "node", args: ["scripts/test-downstream-mcp.mjs"] }) }
);

console.log("\n✅ Done");
