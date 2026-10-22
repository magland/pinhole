CREATE TABLE runs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	local_run_id TEXT NOT NULL,
	user TEXT NOT NULL,
	uploaded_at TEXT NOT NULL,
	task TEXT NOT NULL,
	model TEXT NOT NULL,
	harness_version TEXT,
	system_prompt TEXT,
	turns INTEGER NOT NULL,
	read_tokens_total INTEGER NOT NULL,
	notes_tokens_total INTEGER NOT NULL,
	notes_tokens_max INTEGER NOT NULL,
	result_tokens_total INTEGER NOT NULL,
	result_tokens_max INTEGER NOT NULL,
	overhead_tokens INTEGER NOT NULL,
	model_output_tokens INTEGER NOT NULL,
	parse_errors INTEGER NOT NULL,
	cost_usd REAL NOT NULL,
	finished INTEGER NOT NULL,
	self_reported_success INTEGER,
	self_report_reason TEXT,
	summary_json TEXT NOT NULL,
	UNIQUE (user, local_run_id)
);

CREATE TABLE turns (
	run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
	turn INTEGER NOT NULL,
	notes_tokens INTEGER NOT NULL,
	result_tokens INTEGER NOT NULL,
	notes TEXT,
	action_json TEXT,
	result_shown TEXT,
	result_full_chars INTEGER,
	parse_error TEXT,
	raw_response TEXT,
	PRIMARY KEY (run_id, turn)
);
