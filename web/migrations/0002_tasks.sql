CREATE TABLE tasks (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	text TEXT NOT NULL,
	created_by TEXT NOT NULL,
	created_at TEXT NOT NULL
);

ALTER TABLE runs ADD COLUMN task_id INTEGER REFERENCES tasks(id);
CREATE INDEX runs_task_id ON runs(task_id);
