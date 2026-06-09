import { COMPASS_DECISIONS } from "../executionGatewayContracts";
import type {
	CompassMcpApproval,
	CompassMcpToolResult,
} from "./mcpToolContracts";

type BuildMcpToolResultInput = Omit<
	CompassMcpToolResult,
	"ok" | "decision" | "message" | "reasonCodes"
> & {
	reasonCodes?: string[];
	message?: string;
};

export function buildAllowResult(
	input: BuildMcpToolResultInput,
): CompassMcpToolResult {
	return {
		...input,
		ok: true,
		decision: COMPASS_DECISIONS.ALLOW,
		reasonCodes: input.reasonCodes ?? [],
		message: input.message ?? "Compass allowed this MCP tool call.",
	};
}

export function buildDenyResult(
	input: BuildMcpToolResultInput,
): CompassMcpToolResult {
	return {
		...input,
		ok: false,
		decision: COMPASS_DECISIONS.DENY,
		reasonCodes: input.reasonCodes ?? [],
		message: input.message ?? "Compass denied this MCP tool call.",
	};
}

export function buildRequireApprovalResult(
	input: BuildMcpToolResultInput & { approval: CompassMcpApproval },
): CompassMcpToolResult {
	return {
		...input,
		ok: false,
		decision: COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL,
		reasonCodes: input.reasonCodes ?? [],
		message:
			input.message ??
			"Compass requires human approval before this MCP tool call can proceed.",
	};
}

export function buildRequireAdditionalContextResult(
	input: BuildMcpToolResultInput,
): CompassMcpToolResult {
	return {
		...input,
		ok: false,
		decision: COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
		reasonCodes: input.reasonCodes ?? [],
		message:
			input.message ??
			"Compass requires additional context before this MCP tool call can proceed.",
	};
}
