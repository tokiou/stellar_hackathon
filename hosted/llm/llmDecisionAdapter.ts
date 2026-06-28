/**
 * LLM Decision Adapter - provider boundary for the advisory LLM judge.
 */

import {
	LLM_GUARD_DECISIONS,
	LLM_DECISION_STRICTNESS,
	type LlmClampedDecision,
	type LlmGuardDecision,
	type LlmGuardOutput,
	type LlmJudgeConfig,
	type LlmJudgeInput,
} from "@shared/llmDecisionContracts";
import type { CompassDecision } from "@shared/executionGatewayContracts";

// ── Debug logger (shared file) ──
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

function getLogFile(): string {
	return join(process.cwd(), "logs", "compass-debug.log");
}

function llmDebug(fn: string, message: string, data?: Record<string, unknown>) {
	const raw = process.env["COMPASS_DEBUG"];
	if (!raw || raw.trim() === "" || raw.trim() === "0") return;
	const tokens = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
	if (!tokens.some((t) => t === "true" || t === "1" || t === "*") && !tokens.includes("llm")) return;

	const dir = join(process.cwd(), "logs");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const timestamp = new Date().toISOString();
	const dataStr = data ? ` ${JSON.stringify(data)}` : "";
	appendFileSync(getLogFile(), `[${timestamp}] [llm:${fn}] ${message}${dataStr}\n`, "utf-8");
}

export function resolveLlmConfig(
	env: Record<string, string | undefined> = process.env,
): LlmJudgeConfig {
	const enabled = env.COMPASS_LLM_DECISION_ENABLED === "true";
	return {
		enabled,
		provider: env.COMPASS_LLM_PROVIDER ?? "opencode-go",
		model: env.COMPASS_LLM_MODEL ?? "kimi-k2.5",
		baseUrl: env.COMPASS_LLM_BASE_URL,
		apiKey: env.COMPASS_LLM_API_KEY,
		timeoutMs: env.COMPASS_LLM_TIMEOUT_MS
			? parseInt(env.COMPASS_LLM_TIMEOUT_MS, 10)
			: undefined,
	};
}

export function isLlmConfigured(config: LlmJudgeConfig): boolean {
	if (
		!config.enabled ||
		typeof config.provider !== "string" ||
		config.provider.length === 0 ||
		typeof config.model !== "string" ||
		config.model.length === 0
	) {
		return false;
	}

	if (config.provider === "opencode-go") {
		return typeof config.baseUrl === "string" && config.baseUrl.length > 0;
	}

	return typeof config.apiKey === "string" && config.apiKey.length > 0;
}

const VALID_LLM_DECISIONS = new Set<string>(Object.values(LLM_GUARD_DECISIONS));

export function validateLlmGuardOutput(
	raw: unknown,
): LlmGuardOutput | undefined {
	if (typeof raw !== "object" || raw === null) {
		return undefined;
	}

	const obj = raw as Record<string, unknown>;
	if (
		typeof obj.decision !== "string" ||
		!VALID_LLM_DECISIONS.has(obj.decision)
	) {
		return undefined;
	}
	if (typeof obj.confidence !== "number" || !Number.isFinite(obj.confidence)) {
		return undefined;
	}
	if (!Array.isArray(obj.reasonCodes)) {
		return undefined;
	}
	if (typeof obj.rationale !== "string") {
		return undefined;
	}

	return {
		decision: obj.decision as LlmGuardDecision,
		confidence: obj.confidence,
		reasonCodes: obj.reasonCodes as string[],
		rationale: obj.rationale,
	};
}

export function clampLlmDecision(
	deterministicDecision: CompassDecision,
	llmOutput: LlmGuardOutput | undefined,
): LlmClampedDecision {
	if (!llmOutput) {
		return {
			decision: deterministicDecision,
			llmConsulted: true,
			clamped: false,
		};
	}

	const allowedStrictness =
		LLM_DECISION_STRICTNESS[deterministicDecision] ?? [
			LLM_GUARD_DECISIONS.DENY,
		];

	if (allowedStrictness.includes(llmOutput.decision)) {
		return {
			decision: llmOutput.decision as CompassDecision,
			llmConsulted: true,
			llmOutput,
			clamped: llmOutput.decision !== deterministicDecision,
			llmReasonCodes: llmOutput.reasonCodes,
			llmRationale: llmOutput.rationale,
		};
	}

	return {
		decision: deterministicDecision,
		llmConsulted: true,
		llmOutput,
		clamped: true,
		llmReasonCodes: llmOutput.reasonCodes,
		llmRationale: llmOutput.rationale,
	};
}

export type LlmProviderFn = (input: {
	prompt: string;
	config: LlmJudgeConfig;
	signal?: AbortSignal;
}) => Promise<unknown>;

const LLM_SYSTEM_PROMPT = [
	"You are Compass MCP Guard's advisory risk judge for an execution firewall.",
	"A tool call has been intercepted before execution. Your job is to evaluate whether it is safe to allow.",
	"Return only JSON with: decision (ALLOW | DENY | REQUIRE_HUMAN_APPROVAL | REQUIRE_ADDITIONAL_CONTEXT), confidence (0-1), reasonCodes (array of short codes), and rationale (1-2 sentences explaining your reasoning).",
	"Consider: Is the action a read-only query or a state-changing operation? Is the destination/recipient suspicious? Is the amount unusually large? Does the user's intent match the action?",
	"Be decisive when context is clear. Only REQUIRE_ADDITIONAL_CONTEXT if critical information is genuinely missing.",
	"Never request transaction signing or key exposure.",
].join(" ");

export async function callLlmJudge(
	input: LlmJudgeInput,
	config: LlmJudgeConfig,
	providerFn?: LlmProviderFn,
): Promise<LlmGuardOutput | undefined> {
	llmDebug("callLlmJudge", "Start", {
		toolName: input.toolName,
		actionKind: input.actionKind,
		deterministicDecision: input.deterministicDecision,
		enabled: config.enabled,
		provider: config.provider,
		model: config.model,
	});

	if (!isLlmConfigured(config)) {
		llmDebug("callLlmJudge", "Not configured, skipping", { config });
		return undefined;
	}

	const provider = providerFn ?? defaultProviderFor(config.provider);
	if (!provider) {
		llmDebug("callLlmJudge", "No provider for: " + String(config.provider));
		return undefined;
	}

	const timeoutMs = config.timeoutMs ?? 3000;
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const prompt = JSON.stringify(input);
		const t0 = Date.now();
		llmDebug("callLlmJudge", "Calling provider", {
			provider: config.provider,
			model: config.model,
			timeoutMs,
			promptPreview: prompt.slice(0, 500),
		});

		const raw = await provider({
			prompt,
			config,
			signal: controller.signal,
		});
		clearTimeout(timeoutId);
		const elapsedMs = Date.now() - t0;

		const validated = validateLlmGuardOutput(raw);
		llmDebug("callLlmJudge", "Raw response", {
			toolName: input.toolName,
			elapsedMs,
			raw,
			validated,
		});

		return validated;
	} catch (error) {
		clearTimeout(timeoutId);
		const elapsedMs = Date.now() - (Date.now() - 1);
		const msg = error instanceof Error ? error.message : String(error);
		llmDebug("callLlmJudge", "Error", {
			toolName: input.toolName,
			error: msg,
		});
		return undefined;
	}
}

function defaultProviderFor(provider: string | undefined): LlmProviderFn | undefined {
	if (provider === "opencode-go") {
		return callOpenCodeGoChatCompletions;
	}
	if (provider === "openai") {
		return callOpenAiResponses;
	}
	// Any provider with a baseUrl uses OpenAI-compatible chat completions
	return callOpenCodeGoChatCompletions;
}

async function callOpenCodeGoChatCompletions(input: {
	prompt: string;
	config: LlmJudgeConfig;
	signal?: AbortSignal;
}): Promise<unknown> {
	if (!input.config.baseUrl) {
		return undefined;
	}

	// Ensure URL ends with /chat/completions
	let url = input.config.baseUrl.replace(/\/+$/, "");
	if (!url.endsWith("/chat/completions")) {
		url += "/chat/completions";
	}

	return callChatCompletionsEndpoint({
		url,
		prompt: input.prompt,
		config: input.config,
		signal: input.signal,
	});
}

async function callChatCompletionsEndpoint(input: {
	url: string;
	prompt: string;
	config: LlmJudgeConfig;
	signal?: AbortSignal;
}): Promise<unknown> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};

	if (input.config.apiKey) {
		headers.Authorization = `Bearer ${input.config.apiKey}`;
	}

	const body = JSON.stringify({
		model: input.config.model,
		messages: [
			{ role: "system", content: LLM_SYSTEM_PROMPT },
			{ role: "user", content: input.prompt },
		],
		response_format: { type: "json_object" },
	});

	llmDebug("chatCompletions", "Request", {
		url: input.url,
		model: input.config.model,
		bodyPreview: body.slice(0, 300),
	});

	const t0 = Date.now();
	const response = await fetch(input.url, {
		method: "POST",
		signal: input.signal,
		headers,
		body,
	});

	llmDebug("chatCompletions", "Response status", {
		status: response.status,
		statusText: response.statusText,
		elapsedMs: Date.now() - t0,
	});

	if (!response.ok) {
		const errText = await response.text().catch(() => "unable to read");
		llmDebug("chatCompletions", "Error body", { body: errText.slice(0, 500) });
		return undefined;
	}

	const data = (await response.json()) as {
		choices?: Array<{ message?: { content?: unknown } }>;
	};
	llmDebug("chatCompletions", "Parsed data", {
		choicesCount: data.choices?.length,
		content: typeof data.choices?.[0]?.message?.content === "string"
			? (data.choices[0].message.content as string).slice(0, 500)
			: undefined,
	});

	const content = data.choices?.[0]?.message?.content;
	if (typeof content !== "string") {
		return undefined;
	}

	try {
		return JSON.parse(content);
	} catch {
		return undefined;
	}
}

async function callOpenAiResponses(input: {
	prompt: string;
	config: LlmJudgeConfig;
	signal?: AbortSignal;
}): Promise<unknown> {
	return callResponsesEndpoint({
		url: "https://api.openai.com/v1/responses",
		prompt: input.prompt,
		config: input.config,
		signal: input.signal,
	});
}

async function callResponsesEndpoint(input: {
	url: string;
	prompt: string;
	config: LlmJudgeConfig;
	signal?: AbortSignal;
}): Promise<unknown> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};

	if (input.config.apiKey) {
		headers.Authorization = `Bearer ${input.config.apiKey}`;
	}

	const response = await fetch(input.url, {
		method: "POST",
		signal: input.signal,
		headers,
		body: JSON.stringify({
			model: input.config.model,
			input: [
				{ role: "system", content: LLM_SYSTEM_PROMPT },
				{ role: "user", content: input.prompt },
			],
			text: { format: { type: "json_object" } },
		}),
	});

	if (!response.ok) {
		return undefined;
	}

	const data = (await response.json()) as { output_text?: unknown };
	if (typeof data.output_text !== "string") {
		return undefined;
	}

	try {
		return JSON.parse(data.output_text);
	} catch {
		return undefined;
	}
}

export type EvaluateLlmMetadataParams = {
	input: LlmJudgeInput;
	config: LlmJudgeConfig;
	providerFn?: LlmProviderFn;
};

export async function evaluateLlmMetadata(
	params: EvaluateLlmMetadataParams,
): Promise<LlmClampedDecision> {
	const llmOutput = await callLlmJudge(
		params.input,
		params.config,
		params.providerFn,
	);

	return clampLlmDecision(params.input.deterministicDecision, llmOutput);
}
