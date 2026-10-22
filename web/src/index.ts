// pinhole web API: public reads, passcode-protected writes.

const SUMMARY_COLUMNS = [
	"turns", "read_tokens_total", "notes_tokens_total", "notes_tokens_max", "result_tokens_total",
	"result_tokens_max", "overhead_tokens", "model_output_tokens", "parse_errors", "cost_usd",
] as const;

const LIST_COLUMNS = `id, local_run_id, user, uploaded_at, task, model, harness_version, ${SUMMARY_COLUMNS.join(", ")},
	finished, self_reported_success, self_report_reason`;

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function error(message: string, status: number): Response {
	return json({ error: message }, status);
}

async function passcodeOk(req: Request, env: Env): Promise<boolean> {
	const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
	if (!env.PASSCODE || !given) return false;
	const enc = new TextEncoder();
	const [a, b] = await Promise.all([
		crypto.subtle.digest("SHA-256", enc.encode(given)),
		crypto.subtle.digest("SHA-256", enc.encode(env.PASSCODE)),
	]);
	return crypto.subtle.timingSafeEqual(a, b);
}

type UploadTurn = {
	turn: number;
	notes_tokens: number;
	result_tokens: number;
	notes?: string | null;
	action?: unknown;
	result_shown?: string | null;
	result_full_chars?: number | null;
	parse_error?: string | null;
	raw_response?: string | null;
};

type Upload = { user: string; summary: Record<string, unknown>; turns: UploadTurn[] };

async function createRun(req: Request, env: Env): Promise<Response> {
	if (!(await passcodeOk(req, env))) return error("invalid passcode", 401);
	let body: Upload;
	try {
		body = await req.json();
	} catch {
		return error("invalid JSON", 400);
	}
	const s = body.summary ?? {};
	const user = String(body.user ?? "").trim();
	if (!user) return error("user is required", 400);
	if (typeof s.run_id !== "string" || typeof s.task !== "string" || typeof s.model !== "string")
		return error("summary must include run_id, task and model", 400);
	if (!Array.isArray(body.turns)) return error("turns must be an array", 400);
	for (const c of SUMMARY_COLUMNS) if (typeof s[c] !== "number") return error(`summary.${c} must be a number`, 400);

	const exists = await env.DB.prepare("SELECT id FROM runs WHERE user = ? AND local_run_id = ?")
		.bind(user, s.run_id).first<{ id: number }>();
	if (exists) return error(`run already uploaded (id ${exists.id})`, 409);

	const row = await env.DB.prepare(
		`INSERT INTO runs (local_run_id, user, uploaded_at, task, model, harness_version, system_prompt,
			${SUMMARY_COLUMNS.join(", ")}, finished, self_reported_success, self_report_reason, summary_json)
		VALUES (${Array(11 + SUMMARY_COLUMNS.length).fill("?").join(", ")}) RETURNING id`,
	).bind(
		s.run_id, user, new Date().toISOString(), s.task, s.model, s.harness_version ?? null, s.system_prompt ?? null,
		...SUMMARY_COLUMNS.map((c) => s[c] as number),
		s.finished ? 1 : 0,
		s.self_reported_success == null ? null : s.self_reported_success ? 1 : 0,
		s.self_report_reason ?? null,
		JSON.stringify(s),
	).first<{ id: number }>();
	const id = row!.id;

	const stmt = env.DB.prepare(
		`INSERT INTO turns (run_id, turn, notes_tokens, result_tokens, notes, action_json, result_shown,
			result_full_chars, parse_error, raw_response) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	);
	const inserts = body.turns.map((t) => stmt.bind(
		id, t.turn, t.notes_tokens, t.result_tokens, t.notes ?? null,
		t.action == null ? null : JSON.stringify(t.action), t.result_shown ?? null,
		t.result_full_chars ?? null, t.parse_error ?? null, t.raw_response ?? null,
	));
	try {
		for (let i = 0; i < inserts.length; i += 50) await env.DB.batch(inserts.slice(i, i + 50));
	} catch (e) {
		await env.DB.prepare("DELETE FROM turns WHERE run_id = ?").bind(id).run();
		await env.DB.prepare("DELETE FROM runs WHERE id = ?").bind(id).run();
		return error(`failed to store turns: ${e}`, 400);
	}
	return json({ id }, 201);
}

async function listRuns(env: Env): Promise<Response> {
	const { results } = await env.DB.prepare(`SELECT ${LIST_COLUMNS} FROM runs ORDER BY id DESC`).all();
	return json(results);
}

async function getRun(id: number, env: Env): Promise<Response> {
	const run = await env.DB.prepare(`SELECT ${LIST_COLUMNS}, system_prompt FROM runs WHERE id = ?`).bind(id).first();
	if (!run) return error("not found", 404);
	const { results } = await env.DB.prepare("SELECT * FROM turns WHERE run_id = ? ORDER BY turn").bind(id).all();
	return json({ ...run, turns: results });
}

export default {
	async fetch(req, env): Promise<Response> {
		const url = new URL(req.url);
		const path = url.pathname.replace(/\/+$/, "");
		if (path === "/api/runs" && req.method === "GET") return listRuns(env);
		if (path === "/api/runs" && req.method === "POST") return createRun(req, env);
		const m = path.match(/^\/api\/runs\/(\d+)$/);
		if (m && req.method === "GET") return getRun(Number(m[1]), env);
		return error("not found", 404);
	},
} satisfies ExportedHandler<Env>;
