# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx", "tiktoken"]
# ///
"""Run a notes-only agent on a task in a Docker sandbox and count the tokens it reads."""

import argparse
import json
import os
import re
import subprocess
import time
from pathlib import Path

import httpx
import tiktoken

ROOT = Path(__file__).parent
IMAGE = "pinhole-sandbox"
OUTPUT_CAP = 8000  # chars of command output shown to the agent
CMD_TIMEOUT = 300  # seconds
ENC = tiktoken.get_encoding("o200k_base")


def ntok(s: str) -> int:
    return len(ENC.encode(s))


SYSTEM_PROMPT = """You are carrying out a task inside a Linux sandbox (Debian, Python 3.12, root user, internet access, working directory /work). Tools available include pip, git, curl and w3m (`w3m -dump URL` renders a web page as plain text).

Your goal is to complete the task while reading as little as possible. We measure the number of tokens you read, as a proxy for the reading effort a human would need. Prefer targeted reads (grep, head, sed -n, --help) over dumping whole files or pages, and avoid commands with long output you do not need.

You have no memory between turns. Each turn you see only:
- the task,
- the notes you wrote on the previous turn,
- the last action you took and its result.

Each turn, respond with a single JSON object and nothing else:
{"notes": "...", "action": {...}}

The notes are everything you will know on the next turn, so record what you have learned and what you plan to do next. Keep them short; they count toward tokens read on every turn.

Actions:
- {"type": "run", "cmd": "<shell command>"}: run with bash in /work. Each command starts a fresh shell (cd and environment variables do not persist). Output is stdout and stderr combined; long output is truncated. Timeout 300 s.
- {"type": "write_file", "path": "<path>", "content": "<full file content>"}: create or overwrite a file (relative paths are under /work).
- {"type": "edit_file", "path": "<path>", "old": "<exact text>", "new": "<replacement>"}: replace text that occurs exactly once in the file.
- {"type": "finish", "success": true|false, "reason": "..."}: end the task. If success is true, the reason must cite the evidence (the command you ran and what it showed). If you determine the task cannot be completed, use success false and explain why.
"""


# ---------- sandbox ----------

class Sandbox:
    def __init__(self, name: str):
        self.name = name
        subprocess.run(["docker", "run", "-d", "--name", name, IMAGE, "sleep", "infinity"],
                       check=True, capture_output=True)

    def run(self, cmd: str) -> tuple[int, str]:
        p = subprocess.run(
            ["docker", "exec", "-w", "/work", self.name, "timeout", str(CMD_TIMEOUT), "bash", "-c", cmd],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        out = p.stdout.decode(errors="replace")
        if p.returncode == 124:
            out += f"\n[timed out after {CMD_TIMEOUT} s]"
        return p.returncode, out

    def write(self, path: str, content: str) -> None:
        subprocess.run(["docker", "exec", "-i", "-w", "/work", self.name, "sh", "-c",
                        'mkdir -p "$(dirname "$1")" && cat > "$1"', "sh", path],
                       input=content.encode(), check=True)

    def read(self, path: str) -> str | None:
        p = subprocess.run(["docker", "exec", "-w", "/work", self.name, "cat", path], capture_output=True)
        return p.stdout.decode(errors="replace") if p.returncode == 0 else None

    def save_work(self, dest: Path) -> None:
        with open(dest, "wb") as f:
            subprocess.run(["docker", "exec", self.name, "tar", "-cf", "-", "-C", "/work", "."], stdout=f)

    def remove(self) -> None:
        subprocess.run(["docker", "rm", "-f", self.name], capture_output=True)


def truncate(out: str) -> str:
    if len(out) <= OUTPUT_CAP:
        return out
    head, tail = out[: OUTPUT_CAP * 3 // 5], out[-OUTPUT_CAP * 2 // 5:]
    omitted = out[len(head): len(out) - len(tail)]
    return f"{head}\n[... {len(omitted)} chars, {omitted.count(chr(10))} lines omitted ...]\n{tail}"


def do_action(sb: Sandbox, a: dict) -> tuple[str, str]:
    """Returns (full result, result shown to the agent)."""
    t = a.get("type")
    if t == "run":
        code, out = sb.run(a["cmd"])
        return f"exit code {code}\n{out}", f"exit code {code}\n{truncate(out)}"
    if t == "write_file":
        sb.write(a["path"], a["content"])
        r = f"wrote {a['path']} ({len(a['content'])} chars)"
        return r, r
    if t == "edit_file":
        text = sb.read(a["path"])
        if text is None:
            r = f"error: cannot read {a['path']}"
        elif (n := text.count(a["old"])) != 1:
            r = f"error: old text occurs {n} times in {a['path']}; it must occur exactly once"
        else:
            sb.write(a["path"], text.replace(a["old"], a["new"]))
            r = f"edited {a['path']}"
        return r, r
    r = f"error: unknown action type {t!r}"
    return r, r


def describe_action(a: dict) -> str:
    t = a.get("type")
    if t == "run":
        return f"run: {a['cmd']}"
    if t in ("write_file", "edit_file"):
        return f"{t}: {a['path']}"
    return json.dumps(a)


# ---------- model ----------

def load_key() -> str:
    if k := os.environ.get("OPENROUTER_API_KEY"):
        return k
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("OPENROUTER_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"')
    raise SystemExit("OPENROUTER_API_KEY not set (environment or .env)")


def call_model(key: str, model: str, system: str, user: str) -> tuple[str, dict]:
    r = httpx.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}"},
        json={"model": model, "max_tokens": 8000, "usage": {"include": True},
              "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
        timeout=300)
    r.raise_for_status()
    d = r.json()
    return d["choices"][0]["message"]["content"] or "", d.get("usage", {})


def parse_response(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("no JSON object found")
    d = json.loads(m.group(0))
    if not isinstance(d.get("notes"), str) or not isinstance(d.get("action"), dict):
        raise ValueError('expected {"notes": string, "action": object}')
    return d


# ---------- main loop ----------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("task_file")
    ap.add_argument("--model", default="anthropic/claude-haiku-5.5")
    ap.add_argument("--max-turns", type=int, default=40)
    args = ap.parse_args()

    task = Path(args.task_file).read_text().strip()
    key = load_key()
    run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + Path(args.task_file).stem
    run_dir = ROOT / "runs" / run_id
    run_dir.mkdir(parents=True)
    log = open(run_dir / "events.jsonl", "w")

    def emit(ev: dict):
        log.write(json.dumps(ev) + "\n")
        log.flush()

    s = {"run_id": run_id, "task_file": args.task_file, "model": args.model,
         "overhead_tokens": ntok(SYSTEM_PROMPT) + ntok(task),
         "turns": 0, "notes_tokens_total": 0, "notes_tokens_max": 0,
         "result_tokens_total": 0, "result_tokens_max": 0,
         "model_output_tokens": 0, "provider_prompt_tokens": 0, "provider_completion_tokens": 0,
         "cost_usd": 0.0, "parse_errors": 0, "finished": False, "self_reported_success": None,
         "self_report_reason": None}

    sb = Sandbox("pinhole-" + run_id.lower())
    notes, last = "(none yet)", None  # last = (action description, shown result)
    try:
        for turn in range(1, args.max_turns + 1):
            user = f"# Task\n{task}\n\n# Your notes\n{notes}\n"
            if last:
                user += f"\n# Last action\n{last[0]}\n\n# Result\n{last[1]}\n"
            notes_tok = ntok(notes)
            result_tok = ntok(last[0]) + ntok(last[1]) if last else 0

            text, usage = call_model(key, args.model, SYSTEM_PROMPT, user)
            s["turns"] = turn
            s["notes_tokens_total"] += notes_tok
            s["notes_tokens_max"] = max(s["notes_tokens_max"], notes_tok)
            s["result_tokens_total"] += result_tok
            s["result_tokens_max"] = max(s["result_tokens_max"], result_tok)
            s["model_output_tokens"] += ntok(text)
            s["provider_prompt_tokens"] += usage.get("prompt_tokens", 0)
            s["provider_completion_tokens"] += usage.get("completion_tokens", 0)
            s["cost_usd"] += usage.get("cost", 0) or 0
            ev = {"turn": turn, "input": user, "response": text, "notes_tokens": notes_tok,
                  "result_tokens": result_tok, "usage": usage}

            try:
                d = parse_response(text)
            except (ValueError, json.JSONDecodeError) as e:
                s["parse_errors"] += 1
                last = ("(none: response could not be parsed)", f"error: {e}. Respond with a single JSON object.")
                emit({**ev, "parse_error": str(e)})
                print(f"[{turn}] parse error: {e}")
                continue

            notes, a = d["notes"], d["action"]
            if a.get("type") == "finish":
                s.update(finished=True, self_reported_success=bool(a.get("success")),
                         self_report_reason=a.get("reason"))
                emit({**ev, "notes": notes, "action": a})
                print(f"[{turn}] finish success={a.get('success')}: {a.get('reason')}")
                break
            try:
                full, shown = do_action(sb, a)
            except (KeyError, TypeError) as e:
                full = shown = f"error: malformed action ({e})"
            last = (describe_action(a), shown)
            emit({**ev, "notes": notes, "action": a, "result_full": full, "result_shown": shown})
            print(f"[{turn}] {describe_action(a)[:100]}  -> {ntok(shown)} tok")
    finally:
        s["read_tokens_total"] = s["notes_tokens_total"] + s["result_tokens_total"]
        sb.save_work(run_dir / "work.tar")
        sb.remove()
        (run_dir / "summary.json").write_text(json.dumps(s, indent=2) + "\n")
        log.close()
    print(json.dumps(s, indent=2))


if __name__ == "__main__":
    main()
