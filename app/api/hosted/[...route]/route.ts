import {
	createHostedApp,
} from "@hosted/app";
import type { Hono } from "hono";

const HOSTED_PREFIX = "/api/hosted";

// ponytail: bracket notation prevents Next.js webpack from inlining
// process.env at build time. This MUST be evaluated at runtime.
function readApiKey(): string | undefined {
	const key = process.env["COMPASS_HOSTED_API_KEY"];
	return key && key.trim().length > 0 ? key.trim() : undefined;
}

// ponytail: lazy-init so process.env is read at request time, not build time
let cachedApp: Hono | undefined;
function getApp(): Hono {
	if (!cachedApp) {
		cachedApp = createHostedApp({
			auth: { apiKey: readApiKey() },
			health: {
				dependencies: {
					auditStore: "ok",
					policy: "ok",
					llm: "ok",
				},
			},
		});
	}
	return cachedApp;
}

export async function GET(request: Request) {
	return handleRequest(request);
}
export async function POST(request: Request) {
	return handleRequest(request);
}
export async function PUT(request: Request) {
	return handleRequest(request);
}
export async function DELETE(request: Request) {
	return handleRequest(request);
}
export async function PATCH(request: Request) {
	return handleRequest(request);
}
export async function OPTIONS(request: Request) {
	return handleRequest(request);
}
export async function HEAD(request: Request) {
	return handleRequest(request);
}

async function handleRequest(request: Request): Promise<Response> {
	const url = new URL(request.url);
	url.pathname = stripHostedPrefix(url.pathname);

	return getApp().fetch(
		new Request(url, {
			method: request.method,
			headers: request.headers,
			body: shouldSendBody(request.method) ? request.body : undefined,
			duplex: "half",
		} as RequestInit),
	);
}

function stripHostedPrefix(pathname: string): string {
	if (pathname === HOSTED_PREFIX) {
		return "/";
	}

	return pathname.startsWith(`${HOSTED_PREFIX}/`)
		? pathname.slice(HOSTED_PREFIX.length)
		: pathname;
}

function shouldSendBody(method?: string): boolean {
	return method !== "GET" && method !== "HEAD";
}
