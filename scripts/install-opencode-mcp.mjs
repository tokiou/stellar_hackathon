#!/usr/bin/env node

/**
 * OpenCode MCP Config Installer for Compass
 *
 * Idempotent, secret-safe installer that writes Compass MCP server config
 * into `.opencode/opencode.json`. Supports `--dry-run`, preserves existing
 * config, creates timestamped backups, and never writes secrets.
 *
 * Usage:
 *   node scripts/install-opencode-mcp.mjs             # write config
 *   node scripts/install-opencode-mcp.mjs --dry-run   # preview only
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OPENCODE_CONFIG_PATH = join(process.cwd(), ".opencode", "opencode.json");
const COMPASS_MCP_KEY = "compass";

const COMPASS_MCP_CONFIG = {
	type: "local",
	command: ["npm", "run", "--silent", "mcp:dev"],
	enabled: true,
	env: {},
};

// Keys that should never be written to config files
const SECRET_ENV_KEYS = [
	/^(COMPASS|OPENAI|ANTHROPIC|LANGCHAIN).*(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)$/i,
	/^(COMPASS|OPENAI|ANTHROPIC).*(SIGNER|PRIVATE_?).*/i,
];

const SENSITIVE_VALUE_PATTERNS = [
	/^(sk-|sk_live_|sk_test_|key_|secret_|token_)/i,
];

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function green(text) {
	return `\x1b[32m${text}\x1b[0m`;
}

function yellow(text) {
	return `\x1b[33m${text}\x1b[0m`;
}

function cyan(text) {
	return `\x1b[36m${text}\x1b[0m`;
}

function timestamp() {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

function isSecretEnvKey(key) {
	return SECRET_ENV_KEYS.some((pattern) => pattern.test(key));
}

function isSensitiveValue(value) {
	if (typeof value !== "string") return false;
	return SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function sanitizeEnv(env) {
	const clean = {};
	for (const [key, value] of Object.entries(env)) {
		if (isSecretEnvKey(key)) {
			continue; // Skip secret keys entirely
		}
		if (isSensitiveValue(value)) {
			continue; // Skip values that look like secrets/tokens
		}
		clean[key] = value;
	}
	return clean;
}

function readJsonFile(filePath) {
	if (!existsSync(filePath)) {
		return null;
	}
	try {
		const content = readFileSync(filePath, "utf-8");
		return JSON.parse(content);
	} catch {
		console.error(yellow(`Warning: Could not parse ${filePath}. Treating as empty.`));
		return {};
	}
}

function writeJsonFile(filePath, data) {
	const dir = join(filePath, "..");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	const content = JSON.stringify(data, null, 2) + "\n";
	writeFileSync(filePath, content, "utf-8");
}

function createBackup(filePath) {
	const backupPath = `${filePath}.backup-${timestamp()}`;
	if (existsSync(filePath)) {
		copyFileSync(filePath, backupPath);
		console.log(cyan(`Backup created: ${backupPath}`));
	}
	return backupPath;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
	console.log(cyan("=== Compass OpenCode MCP Installer ===\n"));

	if (dryRun) {
		console.log(yellow("DRY RUN — no files will be written.\n"));
	}

	// Read existing config
	const existingConfig = readJsonFile(OPENCODE_CONFIG_PATH);
	const config = existingConfig ?? {};

	// Check if compass is already configured
	const mcp = config.mcp ?? {};
	const currentCompass = mcp[COMPASS_MCP_KEY];

	const needsUpdate =
		!currentCompass ||
		currentCompass.type !== COMPASS_MCP_CONFIG.type ||
		JSON.stringify(currentCompass.command) !==
			JSON.stringify(COMPASS_MCP_CONFIG.command) ||
		currentCompass.enabled !== COMPASS_MCP_CONFIG.enabled;

	if (!needsUpdate && currentCompass) {
		console.log(green("✓ Compass MCP is already correctly configured in opencode.json"));
		console.log(`  Config: ${JSON.stringify(currentCompass, null, 2).split("\n").join("\n  ")}`);
		console.log();
		console.log(yellow("Restart OpenCode to apply: just close and reopen your editor/terminal."));
		return;
	}

	// Build updated config — preserve all existing fields
	const updatedMcp = { ...mcp };
	// Never write secrets — compass env: {} should stay empty
	updatedMcp[COMPASS_MCP_KEY] = {
		...COMPASS_MCP_CONFIG,
		env: sanitizeEnv(COMPASS_MCP_CONFIG.env),
	};

	const updatedConfig = {
		...config,
		mcp: updatedMcp,
	};

	// Preserve $schema and instructions from existing config
	if (config.$schema) {
		updatedConfig.$schema = config.$schema;
	}
	if (config.instructions) {
		updatedConfig.instructions = config.instructions;
	}

	// Print planned changes
	console.log("Planned changes to .opencode/opencode.json:");
	console.log();
	console.log("  mcp.compass =");
	console.log(`    type: "${COMPASS_MCP_CONFIG.type}"`);
	console.log(`    command: ${JSON.stringify(COMPASS_MCP_CONFIG.command)}`);
	console.log(`    enabled: ${COMPASS_MCP_CONFIG.enabled}`);
	console.log(`    env: {}`);
	console.log();

	if (dryRun) {
		console.log(yellow("DRY RUN: No files were written."));
		console.log();
		console.log(yellow("To apply, run without --dry-run:"));
		console.log("  npm run mcp:install:opencode");
		return;
	}

	// Create backup before writing
	createBackup(OPENCODE_CONFIG_PATH);

	// Write updated config
	writeJsonFile(OPENCODE_CONFIG_PATH, updatedConfig);
	console.log(green("✓ Updated .opencode/opencode.json with Compass MCP config"));
	console.log();
	console.log(yellow("Restart OpenCode to apply: just close and reopen your editor/terminal."));
}

main();