import sys

from . import __version__

USAGE = f"""pinhole {__version__}

usage:
  pinhole run (TASK_FILE | --task TEXT | --task-id N) [options]   run the agent on a task
  pinhole upload RUN_DIR [--user NAME]                            upload a finished run

Run `pinhole run --help` for options. Settings are read from the environment or from .env in the
current directory: PINHOLE_PASSCODE (shared passcode), OPENROUTER_API_KEY (optional, your own key).
Runs are written to ./runs/."""


def main():
    cmd, rest = (sys.argv[1], sys.argv[2:]) if len(sys.argv) > 1 else (None, [])
    if cmd == "run":
        from .run import main as run_main
        run_main(rest)
    elif cmd == "upload":
        from .upload import main as upload_main
        upload_main(rest)
    elif cmd in ("--version", "-V"):
        print(__version__)
    else:
        print(USAGE)
        sys.exit(0 if cmd in ("-h", "--help") else 2)
