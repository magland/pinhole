// pinhole web frontend: run list at "/", run viewer at "/runs/<id>".

const app = document.getElementById("app");
const tooltip = document.getElementById("tooltip");

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const n = (x) => Number(x ?? 0).toLocaleString();
const date = (iso) => esc(String(iso).slice(0, 16).replace("T", " "));

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
	const m = location.pathname.match(/^\/runs\/(\d+)\/?$/);
	if (m) return showRun(Number(m[1]));
	return showList();
}

// ---------- run list ----------

async function showList() {
	document.title = "pinhole";
	app.innerHTML = `
		<h1>pinhole</h1>
		<p class="lede">Each run is an agent with no memory between turns: it sees only the task, its own notes and the result of its last action. Read tokens (notes plus results) estimate the reading effort a task requires. Success is self-reported by the agent.</p>
		<div class="table-wrap"><table>
			<thead><tr>
				<th>#</th><th>Uploaded</th><th>User</th><th>Task</th><th>Model</th><th>Outcome</th>
				<th class="num">Turns</th><th class="num">Read tokens</th><th class="num">Max notes</th>
				<th class="num">Max result</th><th class="num">Cost</th>
			</tr></thead>
			<tbody id="runs"><tr><td colspan="11" class="empty">Loading...</td></tr></tbody>
		</table></div>`;
	const tbody = document.getElementById("runs");
	try {
		const runs = await getJSON("/api/runs");
		if (!runs.length) { tbody.innerHTML = '<tr><td colspan="11" class="empty">No runs uploaded yet.</td></tr>'; return; }
		tbody.innerHTML = runs.map((r) => {
			const o = outcome(r);
			return `<tr class="link" data-href="/runs/${r.id}">
				<td><a href="/runs/${r.id}" data-nav>${r.id}</a></td>
				<td class="nowrap">${date(r.uploaded_at)}</td>
				<td>${esc(r.user)}</td>
				<td class="task">${esc(r.task)}</td>
				<td class="nowrap">${esc(r.model)}</td>
				<td class="nowrap"><span class="${o.cls}">${o.text}</span></td>
				<td class="num">${r.turns}</td>
				<td class="num"><strong>${n(r.read_tokens_total)}</strong></td>
				<td class="num">${n(r.notes_tokens_max)}</td>
				<td class="num">${n(r.result_tokens_max)}</td>
				<td class="num">$${Number(r.cost_usd).toFixed(4)}</td>
			</tr>`;
		}).join("");
		tbody.querySelectorAll("tr.link").forEach((tr) => tr.addEventListener("click", (e) => {
			if (!e.target.closest("a") && !getSelection().toString()) navigate(tr.dataset.href);
		}));
	} catch (e) {
		tbody.innerHTML = `<tr><td colspan="11" class="empty">Failed to load runs: ${esc(e.message)}</td></tr>`;
	}
}

// ---------- run viewer ----------

async function showRun(id) {
	document.title = `pinhole: run ${id}`;
	app.innerHTML = `<div class="crumb"><a href="/" data-nav>All runs</a></div><p class="muted">Loading...</p>`;
	let r, turns;
	try {
		({ run: r, turns } = await getJSON(`/api/runs/${id}`));
	} catch (e) {
		app.innerHTML = `<div class="crumb"><a href="/" data-nav>All runs</a></div><p class="bad">Failed to load run ${id}: ${esc(e.message)}</p>`;
		return;
	}
	const o = outcome(r);
	app.innerHTML = `
		<div class="crumb"><a href="/" data-nav>All runs</a></div>
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
