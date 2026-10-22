"""Upload a run directory (runs/<id>/) to the pinhole web app."""

import argparse
import json
import os
from pathlib import Path

import httpx

DEFAULT_URL = "https://pinhole.jeremy-magland.workers.dev"


def env_value(name: str) -> str | None:
    """Read a setting from the environment, falling back to .env in the current directory."""
    if v := os.environ.get(name):
        return v
    env = Path.cwd() / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"')
    return None


def site_url() -> str:
    return (env_value("PINHOLE_URL") or DEFAULT_URL).rstrip("/")


def fetch_task(task_id: int) -> str:
    """Fetch a task's text from the web app."""
    r = httpx.get(f"{site_url()}/api/tasks/{task_id}", timeout=60)
    if r.status_code != 200:
        raise SystemExit(f"could not fetch task {task_id}: HTTP {r.status_code} {r.text}")
    return r.json()["task"]["text"]


def build_payload(run_dir: Path, user: str | None) -> dict:
    summary = json.loads((run_dir / "summary.json").read_text())
    user = user or summary.get("user")
    if not user:
        raise SystemExit("no user name: pass --user")
    turns = []
    for line in (run_dir / "events.jsonl").read_text().splitlines():
        ev = json.loads(line)
        turns.append({
            "turn": ev["turn"],
            "notes_tokens": ev["notes_tokens"],
            "result_tokens": ev["result_tokens"],
            "notes": ev.get("notes"),
            "action": ev.get("action"),
            "result_shown": ev.get("result_shown"),
            "result_full_chars": len(ev["result_full"]) if "result_full" in ev else None,
            "parse_error": ev.get("parse_error"),
            "raw_response": ev["response"] if "parse_error" in ev else None,
        })
    return {"user": user, "summary": summary, "turns": turns}


def upload_run(run_dir: Path, user: str | None = None) -> str:
    """Upload a run and return the URL of its page on the site."""
    passcode = env_value("PINHOLE_PASSCODE")
    if not passcode:
        raise SystemExit("PINHOLE_PASSCODE not set (environment or .env)")
    url = site_url()
    r = httpx.post(f"{url}/api/runs", json=build_payload(run_dir, user),
                   headers={"Authorization": f"Bearer {passcode}"}, timeout=120)
    if r.status_code != 201:
        raise SystemExit(f"upload failed: HTTP {r.status_code} {r.text}")
    return f"{url}/runs/{r.json()['id']}"


def main(argv: list[str] | None = None):
    ap = argparse.ArgumentParser(prog="pinhole upload", description="Upload a run directory to the web app.")
    ap.add_argument("run_dir", type=Path)
    ap.add_argument("--user", help="user name (default: the user recorded in the run)")
    args = ap.parse_args(argv)
    print(f"Uploaded: {upload_run(args.run_dir, args.user)}")

