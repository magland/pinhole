CREATE TABLE llm_calls (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user TEXT NOT NULL,
	model TEXT NOT NULL,
	prompt_tokens INTEGER,
	completion_tokens INTEGER,
	cost_usd REAL NOT NULL,
	status INTEGER NOT NULL,
	created_at TEXT NOT NULL
);

CREATE INDEX llm_calls_created_at ON llm_calls(created_at);
