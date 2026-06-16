#!/usr/bin/env node
// Test the Compass MCP proxy wrapping a downstream MCP server.
// Sends initialize handshake, tools/list, and tools/call requests.

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
    const isInitialize = method === "initialize";
    setTimeout(() => {
      proc.stdout.off("data", onData);
      reject(new Error(`timeout for ${method} (${isInitialize ? "15s" : "8s"})`));
    }, isInitialize ? 15000 : 8000);
  });
}

async function runTests(label, cmd, args, env) {
  console.log(`\n--- Testing ${label} ---`);
  const stderrChunks = [];
  const proc = spawn(cmd, args, {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: process.cwd(),
    env: env ?? process.env,
  });
  proc.stderr.on("data", (chunk) => stderrChunks.push(chunk.toString()));
  try {
    // MCP initialize handshake
    const init = await sendRequest(proc, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-runner", version: "0.0.0" },
    });
    console.log("  initialize:", init.result?.serverInfo?.name ?? "ok");
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

    const list = await sendRequest(proc, "tools/list");
    const tools = list.result?.tools?.map(t => t.name) ?? [];
    console.log(`  tools/list: [${tools.join(", ")}]`);

    const echo = await sendRequest(proc, "tools/call", {
      name: "echo",
      arguments: { message: "hola compass proxy" },
    });
    console.log("  echo:", echo.result?.content?.[0]?.text);

    const add = await sendRequest(proc, "tools/call", {
      name: "add",
      arguments: { a: 123, b: 456 },
    });
    console.log("  add(123,456):", add.result?.content?.[0]?.text);
  } finally {
    proc.kill();
    await once(proc, "close").catch(() => {});
    const stderr = stderrChunks.join("").trim();
    if (stderr) console.log("  [stderr]:", stderr.slice(0, 300));
  }
}

async function main() {
  const mode = process.argv[2] || "both";

  if (mode === "downstream" || mode === "both") {
    await runTests("downstream directly", "npx", [
      "-y", "tsx", "scripts/test-downstream-mcp.mjs",
    ]);
  }

  if (mode === "compass" || mode === "both") {
    const downstreamConfig = JSON.stringify({
      command: "npx",
      args: ["-y", "tsx", "scripts/test-downstream-mcp.mjs"],
    });
    await runTests("Compass proxy", "npx", [
      "-y", "tsx", "back/services/mcp/server/mcpServer.ts",
    ], {
      ...process.env,
      COMPASS_MCP_DOWNSTREAM_CONFIG: downstreamConfig,
    });
  }

  console.log("\n✅ Done");
}

main().catch(console.error);