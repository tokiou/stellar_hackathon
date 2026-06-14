# Proposal: Wave 11 MCP Proxy Architecture

## Intent

Compass's static/manual MCP tool registry does not scale to wrapping arbitrary local MCP servers. Wave 11 turns Compass into an Agentwall-style MCP firewall/proxy: the agent connects only to Compass, while Compass connects to downstream MCP servers, enforces policy centrally, and forwards only guarded calls.

## Product Value

- Agents keep using MCP tools with minimal workflow change.
- Teams gain one enforcement point for policy, risk, audit, and fail-closed behavior.
- Compass expands beyond native tools without giving agents direct access to unsafe execution paths.

## Scope

### In Scope
- Dynamic aggregation of downstream local MCP tools into one Compass `tools/list` surface.
- Guarded forwarding of downstream `tools/call` through Compass policy/classification boundaries.
- Namespaced downstream tools to avoid collisions and preserve audit clarity.
- Local config migration and installer plan so Compass becomes the only exposed MCP.
- Policy overlays/classification defaults for downstream tools.
- Fail-closed behavior when a tool, policy, or downstream server cannot be trusted.

### Out of Scope
- Production wallet approval implementation.
- Remote/cloud MCP marketplace support.
- Replacing Wave 10 native tools or weakening their constraints.
- Any execution path that bypasses Compass guardrails.

## Capabilities

### New Capabilities
- `mcp-proxy-aggregation`: Discover and publish downstream local MCP tools behind Compass.
- `mcp-proxy-forwarding`: Guard, classify, and forward downstream tool calls.
- `mcp-local-config-migration`: Move local MCP client setup to Compass-first proxy mode.

### Modified Capabilities
- `two-tool-e2e-mcp`: Preserve Wave 10 public guardrail rules while adding proxied downstream tools.

## Approach

Adopt a hybrid proxy architecture: keep Compass-native tools first-class and static, add a downstream MCP client/discovery layer for local stdio servers, expose proxied tools under explicit namespaces, and apply Compass policy overlays before forwarding. If discovery, classification, or downstream availability is uncertain, Compass blocks rather than passes through.

## Acceptance Criteria

- Compass can aggregate native and downstream local MCP tools in one public list.
- Every downstream tool call passes through policy/classification before forwarding.
- Downstream tools are namespaced and auditable.
- Installer/config migration preserves local setups without copying secrets into new files.
- Offline or invalid downstream servers fail closed with clear operator guidance.

## Risks & Open Questions

| Item | Type | Note |
|---|---|---|
| Secret handling during config migration | Risk | Preserve indirection; do not duplicate env secrets. |
| Downstream naming/schema instability | Risk | Require namespaces and policy overrides. |
| Startup/runtime dependency on downstream availability | Risk | Separate degraded discovery from unsafe forwarding. |
| Initial Wave 11 downstream support boundary | Open question | Local stdio only, or broader connector abstraction now? |

## Success Criteria

- [ ] Compass is the single MCP surface presented to the agent.
- [ ] Wave 10 native tool guarantees remain intact.
- [ ] Proxied downstream tools cannot execute outside Compass guardrails.
- [ ] Reviewers can define follow-up functional and technical specs from this proposal.

## Next Phases

1. Functional spec: proxy surface, user flows, fail-closed outcomes.
2. Technical spec: discovery lifecycle, forwarding contracts, policy overlay model.
3. Task plan: installer migration, dynamic registry, guarded dispatcher, tests.
