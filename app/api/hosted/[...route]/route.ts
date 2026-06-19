import type { IncomingMessage, ServerResponse } from "node:http";

import {
	createDefaultHostedAppDependencies,
	createHostedApp,
} from "@hosted/app";

const app = createHostedApp(createDefaultHostedAppDependencies());
const HOSTED_PREFIX = "/api/hosted";

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

	return app.fetch(
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
