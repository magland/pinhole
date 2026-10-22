# pinhole

Estimates the complexity of a task by the number of tokens an agent must read to accomplish it. The agent has no memory between turns: each turn it sees only the task, its own notes from the previous turn, and the result of its last action. It then writes new notes and picks the next action (`run`, `write_file`, `edit_file`, `finish`). Tokens read (notes plus action results) serve as a proxy for human reading effort; the minimum over models, prompts and seeds estimates the task's complexity.

Tasks, runs and results are at https://pinhole.jeremy-magland.workers.dev.

## Setup

Requires [uv](https://docs.astral.sh/uv/) and Docker. Settings are read from the environment or from a `.env` file in the directory you run from:

```
PINHOLE_PASSCODE=...      # shared passcode: uploads, and model calls on the site's key
OPENROUTER_API_KEY=...    # optional: use your own OpenRouter key instead
```

The first run builds the sandbox image (`pinhole-sandbox:<hash>`) from the bundled `pinhole/sandbox/Dockerfile`.

## Run

```
uvx --from git+https://github.com/magland/pinhole pinhole run --task-id N --user NAME --upload
```

The task can also come from a file or the command line: `pinhole run (TASK_FILE | --task "..." | --task-id N)`. Other options: `--model` (default `anthropic/claude-haiku-5.5`), `--max-turns` (default 40), `--llm auto|openrouter|site`. Upload an earlier run with `pinhole upload runs/<id> --user NAME`. To pick up a newer version, add `--refresh` after `uvx`. For development, `uv run pinhole run ...` in a clone.

The run is printed to the console as it goes and written to `./runs/<id>/`:

- `transcript.md`: the same text as the console. It has the task and system prompt, then for each turn the tokens read, the notes written, the action and the result shown to the agent, and a summary at the end. It is meant for a human or an LLM judge to read.
- `events.jsonl`: per turn, the full model input and response, parsed notes and action, full and shown result, token counts, provider usage.
- `summary.json`: totals (see below) and the agent's self-reported outcome.
- `work.tar`: final contents of `/work` in the sandbox.

Tokens are counted with tiktoken `o200k_base` on the text the agent sees, so counts are comparable across models. `overhead_tokens` (system prompt plus task) is counted once. `read_tokens_total` = `notes_tokens_total` + `result_tokens_total`; command output beyond 8000 chars is truncated and only the shown part counts.

Success is self-reported by the agent; verification by a stronger model is a separate, later step.

## Web app

https://pinhole.jeremy-magland.workers.dev lists tasks, each with its runs and the fewest read tokens among self-reported successes. Tasks are created on the site (passcode required); a task's page shows the command to run it (`--task-id N --user NAME --upload`), which fetches the task text from the site. Runs from a task file or `--task` can be uploaded too and appear under All runs as ad hoc. Viewing is public; uploading needs the shared passcode (`PINHOLE_PASSCODE`). Upload with `--upload` on a run, or afterwards with `pinhole upload`.

The app is a Cloudflare Worker with a D1 database, in `web/` (`npm run dev`, `npm run deploy`; schema in `web/migrations/`).

Model calls go to OpenRouter directly when `OPENROUTER_API_KEY` is set, otherwise through the site's `/api/llm` proxy, which uses the site's own key (`--llm` forces either). The proxy needs the passcode and `--user`, forwards only the models in `ALLOWED_MODELS` (`web/wrangler.jsonc`), clamps `max_tokens`, logs each call's cost in D1, and refuses calls once the day's logged spend reaches `DAILY_CAP_USD` (UTC). `GET /api/usage` shows the allowed models, today's spend and spend per user.
