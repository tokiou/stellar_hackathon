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
import { existsSync, openSync, readSync, fstatSync, closeSync } from "node:fs";

const PORT = Number(process.env.COMPASS_DASHBOARD_PORT || 4173);
const EVENTS_FILE = process.env.COMPASS_EVENTS_FILE || ".compass-events.jsonl";

const PAGE = `<!doctype html><html><head><meta charset="utf-8"/>
<title>Compass — live guard</title><style>
 body{font:14px ui-monospace,Menlo,monospace;background:#0b0e14;color:#cdd6f4;margin:0;padding:24px}
 h1{font-size:16px;margin:0 0 4px} .sub{color:#7f849c;margin:0 0 16px}
 table{border-collapse:collapse;width:100%} th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #1e2230;vertical-align:top}
 th{color:#7f849c;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.05em}
 .pill{padding:2px 10px;border-radius:999px;font-weight:700;font-size:12px}
 .allow{background:#1e3a2a;color:#a6e3a1}.deny{background:#3a1e22;color:#f38ba8}.require_approval{background:#3a341e;color:#f9e2af}
 .tool{color:#89b4fa}.reason{color:#9399b2;max-width:680px}.ts{color:#585b70;white-space:nowrap}
 .counts span{margin-right:16px}
</style></head><body>
 <h1>🧭 Compass — live guard</h1>
 <p class="sub">Decisions intercepted by the proxy. <span id="conn">connecting…</span></p>
 <p class="counts"><span>allow <b id="c-allow">0</b></span><span>deny <b id="c-deny">0</b></span><span>escalate <b id="c-esc">0</b></span></p>
 <table><thead><tr><th>time</th><th>decision</th><th>tool</th><th>reason</th></tr></thead><tbody id="rows"></tbody></table>
<script>
 const rows=document.getElementById('rows');
 const c={allow:0,deny:0,require_approval:0};
 const es=new EventSource('/events');
 es.onopen=()=>document.getElementById('conn').textContent='live';
 es.onerror=()=>document.getElementById('conn').textContent='disconnected';
 es.onmessage=(e)=>{const ev=JSON.parse(e.data);c[ev.outcome]=(c[ev.outcome]||0)+1;
   document.getElementById('c-allow').textContent=c.allow;
   document.getElementById('c-deny').textContent=c.deny;
   document.getElementById('c-esc').textContent=c.require_approval;
   const label=ev.outcome==='require_approval'?'ESCALATE':ev.outcome.toUpperCase();
   const tr=document.createElement('tr');
   tr.innerHTML='<td class=ts>'+new Date(ev.ts).toLocaleTimeString()+'</td>'+
     '<td><span class="pill '+ev.outcome+'">'+label+'</span></td>'+
     '<td class=tool>'+ev.tool+'</td><td class=reason>'+(ev.reason||'')+'</td>';
   rows.prepend(tr);};
</script></body></html>`;

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
	res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
	res.end(PAGE);
}).listen(PORT, () => {
	console.log(`Compass dashboard on http://localhost:${PORT} (tailing ${EVENTS_FILE})`);
});
