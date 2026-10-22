// pinhole web frontend: tasks at "/", a task at "/tasks/<id>", all runs at "/runs", a run at "/runs/<id>".

const app = document.getElementById("app");
const tooltip = document.getElementById("tooltip");

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const n = (x) => Number(x ?? 0).toLocaleString();
const date = (iso) => esc(String(iso).slice(0, 16).replace("T", " "));
const firstLine = (s, max = 140) => {
	const line = String(s).split("\n")[0];
	return line.length > max ? line.slice(0, max - 1) + "…" : line;
};

// Per-viewer conveniences only; the page works without storage.
const store = {
	get(k) { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } },
	set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

function outcome(r) {
	if (!r.finished) return { cls: "warn", text: "did not finish" };
	return r.self_reported_success ? { cls: "ok", text: "success" } : { cls: "bad", text: "gave up" };
}

async function getJSON(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(res.status === 404 ? "not found" : `HTTP ${res.status}`);
	return res.json();
}

function navigate(path) {
	history.pushState(null, "", path);
	route();
}

document.addEventListener("click", (e) => {
	const a = e.target.closest("a[data-nav]");
	if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
		e.preventDefault();
		navigate(a.getAttribute("href"));
	}
});
window.addEventListener("popstate", route);

function route() {
	tooltip.hidden = true;
	window.scrollTo(0, 0);
	const p = location.pathname.replace(/\/+$/, "");
	let m;
	if ((m = p.match(/^\/runs\/(\d+)$/))) return showRun(Number(m[1]));
	if ((m = p.match(/^\/tasks\/(\d+)$/))) return showTask(Number(m[1]));
	if (p === "/runs") return showAllRuns();
	return showTasks();
}

function nav(active) {
	const link = (href, label, key) => `<a href="${href}" data-nav class="${active === key ? "active" : ""}">${label}</a>`;
	return `<header class="top"><a href="/" data-nav class="brand">pinhole</a>
		<nav>${link("/", "Tasks", "tasks")}${link("/runs", "All runs", "runs")}</nav></header>`;
}

const LEDE = `<p class="lede">pinhole estimates how much reading a task requires. An agent with no memory between turns works on the task: each turn it sees only the task, its own notes and the result of its last action. Read tokens (notes plus results) are counted; the fewest read tokens over successful runs estimates the task's complexity. Success is currently self-reported by the agent.</p>`;

// ---------- tasks ----------

async function showTasks() {
	document.title = "pinhole";
	app.innerHTML = `${nav("tasks")}${LEDE}
		<details class="new-task"><summary>New task</summary>
			<form id="new-task">
				<label>Task<textarea name="text" rows="5" required placeholder="Describe what the agent should do, e.g. install a package from its docs and run an example."></textarea></label>
				<div class="row">
					<label>Your name<input name="user" required value="${esc(store.get("pinhole-user"))}"></label>
					<label>Passcode<input name="passcode" type="password" required value="${esc(store.get("pinhole-passcode"))}"></label>
					<button type="submit">Create task</button>
				</div>
				<p class="form-msg" id="new-task-msg"></p>
			</form>
		</details>
		<div class="table-wrap"><table>
			<thead><tr><th>#</th><th>Task</th><th>Created by</th><th class="num">Runs</th><th class="num">Successes</th>
				<th class="num">Best read tokens</th></tr></thead>
			<tbody id="tasks"><tr><td colspan="6" class="empty">Loading...</td></tr></tbody>
		</table></div>`;
	document.getElementById("new-task").addEventListener("submit", createTask);
	const tbody = document.getElementById("tasks");
	try {
		const tasks = await getJSON("/api/tasks");
		if (!tasks.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty">No tasks yet.</td></tr>'; return; }
		tbody.innerHTML = tasks.map((t) => `<tr class="link" data-href="/tasks/${t.id}">
			<td><a href="/tasks/${t.id}" data-nav>${t.id}</a></td>
			<td class="task">${esc(firstLine(t.text))}</td>
			<td>${esc(t.created_by)}</td>
			<td class="num">${t.run_count}</td>
			<td class="num">${t.success_count}</td>
			<td class="num">${t.best_read_tokens == null ? '<span class="muted">none</span>' : `<strong>${n(t.best_read_tokens)}</strong>`}</td>
		</tr>`).join("");
		bindRowLinks(tbody);
	} catch (e) {
		tbody.innerHTML = `<tr><td colspan="6" class="empty">Failed to load tasks: ${esc(e.message)}</td></tr>`;
	}
}

async function createTask(e) {
	e.preventDefault();
	const f = e.target;
	const msg = document.getElementById("new-task-msg");
	const user = f.user.value.trim(), passcode = f.passcode.value;
	store.set("pinhole-user", user);
	store.set("pinhole-passcode", passcode);
	msg.textContent = "Creating...";
	msg.className = "form-msg";
	try {
		const res = await fetch("/api/tasks", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${passcode}` },
			body: JSON.stringify({ text: f.text.value, user }),
		});
		const data = await res.json();
		if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
		navigate(`/tasks/${data.id}`);
	} catch (err) {
		msg.textContent = `Could not create task: ${err.message}`;
		msg.className = "form-msg bad";
	}
}

async function showTask(id) {
	document.title = `pinhole: task ${id}`;
	app.innerHTML = `${nav("tasks")}<p class="muted">Loading...</p>`;
	let task, runs;
	try {
		({ task, runs } = await getJSON(`/api/tasks/${id}`));
	} catch (e) {
		app.innerHTML = `${nav("tasks")}<p class="bad">Failed to load task ${id}: ${esc(e.message)}</p>`;
		return;
	}
	app.innerHTML = `${nav("tasks")}
		<h1>Task ${task.id}</h1>
		<div class="meta"><span>Created by <b>${esc(task.created_by)}</b></span><span>Created <b>${date(task.created_at)}</b></span></div>
		<p class="task-text">${esc(task.text)}</p>
		<div class="stats">
			<div class="stat"><div class="label">Best read tokens</div><div class="value">${task.best_read_tokens == null ? "none" : n(task.best_read_tokens)}</div><div class="sub">fewest among successful runs</div></div>
			<div class="stat"><div class="label">Runs</div><div class="value">${task.run_count}</div><div class="sub">${task.success_count} self-reported success${task.success_count === 1 ? "" : "es"}</div></div>
		</div>
		<h2>Run this task</h2>
		<p class="muted small">From a clone of the pinhole repo, with <code>OPENROUTER_API_KEY</code> and <code>PINHOLE_PASSCODE</code> in <code>.env</code> and Docker running. The run uploads here when it finishes. Add <code>--model &lt;openrouter-id&gt;</code> to try another model.</p>
		<label class="inline">Your name <input id="cmd-user" value="${esc(store.get("pinhole-user"))}" placeholder="name"></label>
		<div class="cmd"><pre id="cmd"></pre><button id="copy" type="button">Copy</button></div>
		<h2>Runs</h2>
		${runsTable(runs, false)}`;
	const userInput = document.getElementById("cmd-user");
	const cmd = document.getElementById("cmd");
	const update = () => {
		const u = userInput.value.trim();
		cmd.textContent = `uv run pinhole.py --task-id ${task.id} --user ${u ? shellQuote(u) : "NAME"} --upload`;
	};
	userInput.addEventListener("input", () => { store.set("pinhole-user", userInput.value.trim()); update(); });
	update();
	document.getElementById("copy").addEventListener("click", async (e) => {
		try { await navigator.clipboard.writeText(cmd.textContent); e.target.textContent = "Copied"; }
		catch { e.target.textContent = "Copy failed"; }
		setTimeout(() => { e.target.textContent = "Copy"; }, 1500);
	});
	bindRowLinks(app);
}

const shellQuote = (s) => (/^[\w.@-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

// ---------- run lists ----------

function runsTable(runs, showTask) {
	const cols = 10 + (showTask ? 1 : 0);
	const body = !runs.length ? `<tr><td colspan="${cols}" class="empty">No runs yet.</td></tr>` : runs.map((r) => {
		const o = outcome(r);
		const task = r.task_id != null
			? `<a href="/tasks/${r.task_id}" data-nav>#${r.task_id}</a> ${esc(firstLine(r.task, 90))}`
			: `<span class="muted">ad hoc:</span> ${esc(firstLine(r.task, 90))}`;
		return `<tr class="link" data-href="/runs/${r.id}">
			<td><a href="/runs/${r.id}" data-nav>${r.id}</a></td>
			<td class="nowrap">${date(r.uploaded_at)}</td>
			<td>${esc(r.user)}</td>
			${showTask ? `<td class="task">${task}</td>` : ""}
			<td class="nowrap">${esc(r.model)}</td>
			<td class="nowrap"><span class="${o.cls}">${o.text}</span></td>
			<td class="num">${r.turns}</td>
			<td class="num"><strong>${n(r.read_tokens_total)}</strong></td>
			<td class="num">${n(r.notes_tokens_max)}</td>
			<td class="num">${n(r.result_tokens_max)}</td>
			<td class="num">$${Number(r.cost_usd).toFixed(4)}</td>
		</tr>`;
	}).join("");
	return `<div class="table-wrap"><table>
		<thead><tr>
			<th>#</th><th>Uploaded</th><th>User</th>${showTask ? "<th>Task</th>" : ""}<th>Model</th><th>Outcome</th>
			<th class="num">Turns</th><th class="num">Read tokens</th><th class="num">Max notes</th>
			<th class="num">Max result</th><th class="num">Cost</th>
		</tr></thead><tbody>${body}</tbody></table></div>`;
}

function bindRowLinks(root) {
	root.querySelectorAll("tr.link").forEach((tr) => tr.addEventListener("click", (e) => {
		if (!e.target.closest("a") && !getSelection().toString()) navigate(tr.dataset.href);
	}));
}

async function showAllRuns() {
	document.title = "pinhole: all runs";
	app.innerHTML = `${nav("runs")}<p class="muted">Loading...</p>`;
	try {
		const runs = await getJSON("/api/runs");
		app.innerHTML = `${nav("runs")}${runsTable(runs, true)}`;
		bindRowLinks(app);
	} catch (e) {
		app.innerHTML = `${nav("runs")}<p class="bad">Failed to load runs: ${esc(e.message)}</p>`;
	}
}

// ---------- run viewer ----------

async function showRun(id) {
	document.title = `pinhole: run ${id}`;
	app.innerHTML = `${nav("runs")}<p class="muted">Loading...</p>`;
	let r, turns;
	try {
		({ run: r, turns } = await getJSON(`/api/runs/${id}`));
	} catch (e) {
		app.innerHTML = `${nav("runs")}<p class="bad">Failed to load run ${id}: ${esc(e.message)}</p>`;
		return;
	}
	const o = outcome(r);
	app.innerHTML = `
		${nav(r.task_id != null ? "" : "runs")}
		${r.task_id != null ? `<div class="crumb"><a href="/tasks/${r.task_id}" data-nav>Task ${r.task_id}</a> / run ${r.id}</div>` : ""}
		<h1>Run ${r.id}</h1>
		<div class="meta">
			<span>User <b>${esc(r.user)}</b></span>
			<span>Model <b>${esc(r.model)}</b></span>
			<span>Uploaded <b>${date(r.uploaded_at)}</b></span>
			<span>Harness <b>${esc(r.harness_version ?? "unknown")}</b></span>
			<span>Local id <b>${esc(r.local_run_id)}</b></span>
		</div>
		<p class="task-text">${esc(r.task)}</p>
		<div class="outcome ${o.cls}"><span class="${o.cls}">${o.text[0].toUpperCase() + o.text.slice(1)}</span>
			${r.self_report_reason ? `<p>${esc(r.self_report_reason)}</p>` : ""}</div>
		${stats(r)}
		${r.system_prompt ? `<details class="sys"><summary>System prompt</summary><pre>${esc(r.system_prompt)}</pre></details>` : ""}
		<h2>Tokens read per turn</h2>
		${chart(turns)}
		<h2>Turns</h2>
		${turns.map((t, i) => turnCard(t, turns[i + 1], cumulative(turns, i))).join("")}`;
	bindChart(turns);
	if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
}

function stats(r) {
	const s = (label, value, sub = "") =>
		`<div class="stat"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
	return `<div class="stats">
		${s("Read tokens", n(r.read_tokens_total), "notes + results")}
		${s("Notes tokens", n(r.notes_tokens_total), `max ${n(r.notes_tokens_max)}`)}
		${s("Result tokens", n(r.result_tokens_total), `max ${n(r.result_tokens_max)}`)}
		${s("Turns", r.turns, r.parse_errors ? `${r.parse_errors} parse error${r.parse_errors > 1 ? "s" : ""}` : "")}
		${s("Overhead", n(r.overhead_tokens), "system prompt + task, once")}
		${s("Model output", n(r.model_output_tokens), "tokens written")}
		${s("Cost", `$${Number(r.cost_usd).toFixed(4)}`)}
	</div>`;
}

function cumulative(turns, i) {
	let c = 0;
	for (let k = 0; k <= i; k++) c += turns[k].notes_tokens + turns[k].result_tokens;
	return c;
}

function niceTicks(max) {
	if (max <= 0) return { top: 1, ticks: [0] };
	const raw = max / 3;
	const pow = 10 ** Math.floor(Math.log10(raw));
	const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
	const top = Math.ceil(max / step) * step;
	const ticks = [];
	for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
	return { top, ticks };
}

function chart(turns) {
	const max = Math.max(0, ...turns.map((t) => t.notes_tokens + t.result_tokens));
	const { top, ticks } = niceTicks(max);
	const pct = (v) => `${(100 * v) / top}%`;
	const every = Math.ceil(turns.length / 20);
	return `<div class="chart">
		<div class="legend"><span><i style="background:var(--s-notes)"></i>Notes read</span>
			<span><i style="background:var(--s-result)"></i>Result read</span></div>
		<div class="plot">
			${ticks.map((v) => `<div class="grid" style="bottom:${pct(v)}"><span>${n(v)}</span></div>`).join("")}
			<div class="bars">${turns.map((t, i) => `<div class="bar" data-i="${i}">
				${t.result_tokens ? `<div class="seg result" style="height:${pct(t.result_tokens)}"></div>` : ""}
				${t.notes_tokens ? `<div class="seg notes" style="height:${pct(t.notes_tokens)}"></div>` : ""}
			</div>`).join("")}</div>
		</div>
		<div class="xaxis">${turns.map((t, i) => `<span>${i % every === 0 ? t.turn : ""}</span>`).join("")}</div>
	</div>`;
}

function bindChart(turns) {
	document.querySelectorAll(".bar").forEach((bar) => {
		const t = turns[Number(bar.dataset.i)];
		bar.addEventListener("mousemove", (e) => {
			tooltip.innerHTML = `Turn ${t.turn}: notes ${n(t.notes_tokens)} + result ${n(t.result_tokens)} = ${n(t.notes_tokens + t.result_tokens)}`;
			tooltip.hidden = false;
			const w = tooltip.offsetWidth;
			tooltip.style.left = `${Math.min(e.clientX + 12, innerWidth - w - 8)}px`;
			tooltip.style.top = `${e.clientY + 14}px`;
		});
		bar.addEventListener("mouseleave", () => { tooltip.hidden = true; });
		bar.addEventListener("click", () => {
			history.replaceState(null, "", `#turn-${t.turn}`);
			document.getElementById(`turn-${t.turn}`)?.scrollIntoView({ behavior: "smooth" });
		});
	});
}

function actionBlock(a) {
	const label = (s) => `<div class="block-label">${s}</div>`;
	if (!a) return "";
	if (a.type === "run") return `<div class="block">${label("Action: run")}<pre>${esc(a.cmd)}</pre></div>`;
	if (a.type === "write_file")
		return `<div class="block">${label(`Action: write_file <code>${esc(a.path)}</code>`)}<pre class="scroll">${esc(a.content)}</pre></div>`;
	if (a.type === "edit_file")
		return `<div class="block">${label(`Action: edit_file <code>${esc(a.path)}</code>`)}
			<div class="muted" style="font-size:13px;margin-top:6px">old</div><pre class="scroll">${esc(a.old)}</pre>
			<div class="muted" style="font-size:13px;margin-top:6px">new</div><pre class="scroll">${esc(a.new)}</pre></div>`;
	if (a.type === "finish") {
		const ok = a.success;
		return `<div class="block">${label("Action: finish")}
			<div class="finish"><span class="${ok ? "ok" : "bad"}">${ok ? "Success" : "Gave up"}</span>: ${esc(a.reason)}</div></div>`;
	}
	return `<div class="block">${label("Action (unrecognized)")}<pre>${esc(JSON.stringify(a, null, 2))}</pre></div>`;
}

function turnCard(t, next, cum) {
	const a = t.action_json ? JSON.parse(t.action_json) : null;
	const truncated = t.result_shown && /\[\.\.\. \d+ chars, \d+ lines omitted \.\.\.\]/.test(t.result_shown);
	const resultNote = [
		next ? `read on turn ${next.turn}: ${n(next.result_tokens)} tokens` : "",
		truncated ? `truncated; full result ${n(t.result_full_chars)} chars` : "",
	].filter(Boolean).join("; ");
	return `<section class="turn" id="turn-${t.turn}">
		<div class="turn-head"><h3><a href="#turn-${t.turn}">Turn ${t.turn}</a></h3>
			<span class="read">read: notes ${n(t.notes_tokens)} + result ${n(t.result_tokens)} (cumulative ${n(cum)})</span></div>
		${t.parse_error ? `<div class="block"><div class="block-label bad">Parse error: ${esc(t.parse_error)}</div>
			<pre class="scroll">${esc(t.raw_response)}</pre></div>` : ""}
		${t.notes != null ? `<div class="block"><div class="block-label">Notes written</div><pre>${esc(t.notes)}</pre></div>` : ""}
		${actionBlock(a)}
		${t.result_shown != null ? `<div class="block"><div class="block-label">Result
			${resultNote ? `<span class="note">(${resultNote})</span>` : ""}</div>
			<pre class="scroll">${esc(t.result_shown)}</pre></div>` : ""}
	</section>`;
}

route();
