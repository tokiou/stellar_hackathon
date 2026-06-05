import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { load as loadYaml } from "js-yaml";

import { type CompassPolicy } from "./policyContracts";
import { validateCompassPolicy } from "./policySchema";

const DEFAULT_POLICY_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	"defaultPolicy.yaml",
);

let cachedDefaultPolicy: CompassPolicy | undefined;

export function loadDefaultPolicy(): CompassPolicy {
	cachedDefaultPolicy ??= loadPolicyFromString(
		readFileSync(DEFAULT_POLICY_PATH, "utf8"),
	);

	return cachedDefaultPolicy;
}

export function loadPolicyFromString(policyYaml: string): CompassPolicy {
	let parsedPolicy: unknown;

	try {
		parsedPolicy = loadYaml(policyYaml);
	} catch (error) {
		throw new Error(formatYamlError(error));
	}

	const validation = validateCompassPolicy(parsedPolicy);
	if (validation.ok === false) {
		throw new Error(
			`Invalid policy schema: ${validation.errors
				.map((item) => `${item.path}: ${item.message}`)
				.join("; ")}`,
		);
	}

	return validation.policy;
}

function formatYamlError(error: unknown): string {
	if (isYamlErrorWithMark(error)) {
		return `Invalid policy YAML: line ${error.mark.line + 1}, column ${
			error.mark.column + 1
		}`;
	}

	return "Invalid policy YAML";
}

function isYamlErrorWithMark(
	error: unknown,
): error is { mark: { line: number; column: number } } {
	return (
		typeof error === "object" &&
		error !== null &&
		"mark" in error &&
		typeof error.mark === "object" &&
		error.mark !== null &&
		"line" in error.mark &&
		"column" in error.mark &&
		typeof error.mark.line === "number" &&
		typeof error.mark.column === "number"
	);
}
