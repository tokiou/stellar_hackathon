## Exploration: wave-11-mcp-proxy-architecture

### Current State
Compass currently runs as a single local stdio MCP server (`npm run mcp:dev`) configured in `.opencode/opencode.json`. Its public tool list is built from a static in-repo registry (`PUBLIC_MCP_TOOLS` in `mcpToolRegistry.ts`), and `mcpServer.ts` returns that list directly on `tools/list`. `mcpToolCallRouter.ts` then routes calls through a hardcoded `switch` over known Compass tool names and rejects hidden/internal tools fail-closed. There is no downstream MCP client, no runtime discovery of external tools, and no generic forwarding path.

AgentWall's model is materially different: the client talks to a proxy, the proxy spawns/connects to real MCP servers, dynamically lists downstream tools, evaluates policy outside the model context, and forwards or blocks each call while keeping an independent audit trail.

### Affected Areas
- `.opencode/opencode.json` — currently points the agent at one local Compass server; Wave 11 needs Compass to become the sole exposed MCP surface while downstream servers sit behind it.
- `scripts/install-opencode-mcp.mjs` — currently installs only `mcp.compass`; it would need proxy-aware config migration/wrapping behavior for local MCPs.
- `package.json` — likely needs proxy-oriented dev/install scripts beyond `mcp:dev`.
- `back/services/mcp/mcpServer.ts` — `tools/list` is static today; this becomes the MCP proxy server boundary that merges Compass-native and downstream tools.
- `back/services/mcp/mcpServerContracts.ts` — current contracts assume synchronous local listing and one router; they need downstream discovery/forwarding abstractions.
- `back/services/mcp/mcpToolRegistry.ts` — static public registry is the current source of truth; proxy mode needs dynamic tool sources plus policy metadata overlays.
- `back/services/mcp/mcpToolContracts.ts` — current contracts model only Compass-owned tools/results; proxied tool descriptors and forwarding envelopes need separate contracts.
- `back/services/mcp/mcpToolCallRouter.ts` — hardcoded routing by tool name must evolve into a proxy-aware dispatcher that can guard then forward downstream calls.
- `back/services/__tests__/mcpServer.test.ts` — currently asserts an exact 5-tool public list; tests must shift to dynamic discovery expectations.
- `back/services/__tests__/mcpToolRegistry.test.ts` — currently locks the static Wave 10 surface; needs re-scoping around native vs proxied exposure rules.
- `docs/wave-10-two-tool-e2e-mcp/*` — Wave 10 intentionally optimized for a small static Compass surface; Wave 11 must preserve those guardrails while expanding architecture.

### Approaches
1. **Static proxy mapping** — Keep the current registry model, but add manual entries that represent downstream tools and forward them to downstream MCP servers.
   - Pros: Smallest code delta; keeps current tests/patterns familiar; easy to phase behind feature flags.
   - Cons: Misses the main goal of dynamic discovery; duplicates downstream schemas/descriptions; becomes brittle as downstream MCPs change.
   - Effort: Medium

2. **Dynamic downstream discovery with policy overlays** — Compass loads downstream MCP server configs, connects as an MCP client, fetches `tools/list` at runtime, wraps each tool with Compass metadata/policy defaults, and forwards `tools/call` through one guarded proxy path.
   - Pros: Matches the AgentWall architecture; removes manual schema duplication; lets Compass remain the single enforcement boundary.
   - Cons: Requires new lifecycle/config/discovery contracts; needs naming-collision handling, caching, and downstream failure semantics.
   - Effort: High

3. **Hybrid incremental proxy** — Keep Compass-native tools in the static registry, but add a new downstream proxy layer for discovered tools under explicit namespaces (for example `downstream__filesystem__read_file`) and only support local stdio downstream servers in Wave 11.
   - Pros: Preserves Wave 10 native flows; delivers real dynamic proxying without a full architectural rewrite; reduces collision and audit ambiguity.
   - Cons: Tool names are less elegant at first; installer/config migration still needs careful design; mixed static/dynamic sources add temporary complexity.
   - Effort: Medium

### Recommendation
Use **Approach 3** for Wave 11.

It is the safest incremental path: keep `compass_transfer`, `compass_swap`, and other Compass-native tools as first-class guarded tools, then add a separate downstream discovery/proxy subsystem that exposes proxied tools under explicit namespaces. Concretely, Wave 11 should introduce: (1) downstream server config contracts, (2) an MCP client manager for local stdio servers, (3) dynamic `tools/list` aggregation, (4) a generic guarded forwarder for discovered tools, and (5) an installer update that makes Compass the only MCP presented to the agent while preserving secret-safe behavior.

### Risks
- Current installer/config flow is secret-safe because it writes only `mcp.compass`; proxying downstream MCPs risks leaking or mishandling existing per-server env/config unless Compass preserves indirection instead of copying secrets.
- Dynamic discovery breaks current exact-list assumptions in tests and docs; without a clear native-vs-proxied contract, reviewers will lose the Wave 10 simplicity guarantee.
- Downstream tool naming collisions and unstable schemas can make policy classification ambiguous unless Compass adds namespacing plus policy overrides.
- Downstream MCP availability now affects Compass startup and `tools/list`; Wave 11 needs fail-closed but resilient behavior when a proxied server is offline.

### Ready for Proposal
Yes — tell the user Wave 11 should propose a hybrid proxy architecture: keep native Compass tools static, add a new downstream MCP client/discovery layer with namespaced proxied tools, and update local MCP installation so Compass becomes the single exposed MCP firewall.
