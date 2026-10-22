# pinhole

Estimates the complexity of a task by the number of tokens an agent must read to accomplish it. The agent has no memory between turns: each turn it sees only the task, its own notes from the previous turn, and the result of its last action. It then writes new notes and picks the next action (`run`, `write_file`, `edit_file`, `finish`). Tokens read (notes plus action results) serve as a proxy for human reading effort; the minimum over models, prompts and seeds estimates the task's complexity.

## Setup

```
docker build -t pinhole-sandbox sandbox
echo OPENROUTER_API_KEY=... > .env
echo PINHOLE_PASSCODE=... >> .env   # only needed to upload
```

## Run

```
uv run pinhole.py (tasks/tinydb-example.md | --task "...") [--model anthropic/claude-haiku-5.5] [--max-turns 40] [--user NAME --upload]
```

The run is printed to the console as it goes and written to `runs/<id>/`:

- `transcript.md`: the same text as the console. It has the task and system prompt, then for each turn the tokens read, the notes written, the action and the result shown to the agent, and a summary at the end. It is meant for a human or an LLM judge to read.
- `events.jsonl`: per turn, the full model input and response, parsed notes and action, full and shown result, token counts, provider usage.
- `summary.json`: totals (see below) and the agent's self-reported outcome.
- `work.tar`: final contents of `/work` in the sandbox.

Tokens are counted with tiktoken `o200k_base` on the text the agent sees, so counts are comparable across models. `overhead_tokens` (system prompt plus task) is counted once. `read_tokens_total` = `notes_tokens_total` + `result_tokens_total`; command output beyond 8000 chars is truncated and only the shown part counts.

Success is self-reported by the agent; verification by a stronger model is a separate, later step.

## Web app

https://pinhole.jeremy-magland.workers.dev shows uploaded runs. Viewing is public; uploading needs the shared passcode (`PINHOLE_PASSCODE`). Upload with `--upload` on a run, or afterwards with `uv run upload.py runs/<id> --user NAME`.

The app is a Cloudflare Worker with a D1 database, in `web/` (`npm run dev`, `npm run deploy`; schema in `web/migrations/`).
