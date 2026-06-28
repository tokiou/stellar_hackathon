#!/usr/bin/env node
/**
 * Compass dashboard — live view of what the proxy blocked / allowed / escalated.
 *
 * Tails the proxy decision feed (COMPASS_EVENTS_FILE, JSONL) and streams it to a
 * browser via SSE. Run it alongside the proxy (the launcher sets the same file):
 *
 *   COMPASS_EVENTS_FILE=.compass-events.jsonl node scripts/compass-dashboard.mjs
 *   # open http://localhost:4173
 *
 * No external dependencies.
 */
import { createServer } from "node:http";
import {
	existsSync,
	openSync,
	readSync,
	fstatSync,
	closeSync,
	readFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PORT = Number(process.env.COMPASS_DASHBOARD_PORT || 4173);
const EVENTS_FILE = process.env.COMPASS_EVENTS_FILE || ".compass-events.jsonl";
const HTML_FILE = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"compass-dashboard.html",
);

function loadPage() {
	return readFileSync(HTML_FILE, "utf8");
}

const clients = new Set();

function broadcast(line) {
	for (const res of clients) {
		res.write(`data: ${line}\n\n`);
	}
}

// Tail the JSONL: poll size, read appended bytes, split into lines.
function fileSize(file) {
	const fd = openSync(file, "r");
	try {
		return fstatSync(fd).size;
	} finally {
		closeSync(fd);
	}
}
// Start from the current end so we only show NEW decisions.
let offset = existsSync(EVENTS_FILE) ? fileSize(EVENTS_FILE) : 0;

let carry = "";
setInterval(() => {
	if (!existsSync(EVENTS_FILE)) return;
	const fd = openSync(EVENTS_FILE, "r");
	try {
		const size = fstatSync(fd).size;
		if (size < offset) offset = 0; // file truncated/rotated
		if (size > offset) {
			const buf = Buffer.alloc(size - offset);
			readSync(fd, buf, 0, buf.length, offset);
			offset = size;
			carry += buf.toString("utf8");
			const parts = carry.split("\n");
			carry = parts.pop() ?? "";
			for (const line of parts) {
				if (line.trim()) broadcast(line.trim());
			}
		}
	} finally {
		closeSync(fd);
	}
}, 400);

createServer((req, res) => {
	if (req.url === "/events") {
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});
		res.write("retry: 1000\n\n");
		clients.add(res);
		req.on("close", () => clients.delete(res));
		return;
	}
	if (req.url === "/favicon.ico") {
		res.writeHead(204).end();
		return;
	}
	res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
	res.end(loadPage());
}).listen(PORT, () => {
	console.log(`Compass dashboard on http://localhost:${PORT} (tailing ${EVENTS_FILE})`);
});
