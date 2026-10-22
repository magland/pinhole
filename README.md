# pinhole

Estimates the complexity of a task by the number of tokens an agent must read to accomplish it. The agent has no memory between turns: each turn it sees only the task, its own notes from the previous turn, and the result of its last action. It then writes new notes and picks the next action (`run`, `write_file`, `edit_file`, `finish`). Tokens read (notes plus action results) serve as a proxy for human reading effort; the minimum over models, prompts and seeds estimates the task's complexity.

## Setup

```
docker build -t pinhole-sandbox sandbox
echo OPENROUTER_API_KEY=... > .env
```

## Run

```
uv run pinhole.py tasks/tinydb-example.md [--model anthropic/claude-haiku-5.5] [--max-turns 40]
```

Each run writes `runs/<id>/`:

- `events.jsonl`: per turn, the full model input and response, parsed notes and action, full and shown result, token counts, provider usage.
- `summary.json`: totals (see below) and the agent's self-reported outcome.
- `work.tar`: final contents of `/work` in the sandbox.

Tokens are counted with tiktoken `o200k_base` on the text the agent sees, so counts are comparable across models. `overhead_tokens` (system prompt plus task) is counted once. `read_tokens_total` = `notes_tokens_total` + `result_tokens_total`; command output beyond 8000 chars is truncated and only the shown part counts.

Success is self-reported by the agent; verification by a stronger model is a separate, later step.
