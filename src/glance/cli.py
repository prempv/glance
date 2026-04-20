from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from importlib.metadata import PackageNotFoundError, version as _pkg_version
from pathlib import Path

import uvicorn

from .server import create_app


def _version() -> str:
	try:
		return _pkg_version("glance")
	except PackageNotFoundError:
		return "dev"


def _resolve_workspace(arg_value: str | None, positional: str | None) -> Path:
	raw = arg_value or positional or os.getenv("GLANCE_WORKSPACE") or os.getcwd()
	return Path(raw).expanduser().resolve()


def _resolve_roots(arg_value: str | None) -> list[str] | None:
	raw = arg_value if arg_value is not None else os.getenv("GLANCE_ROOTS")
	if not raw:
		return None
	parsed = [r.strip() for r in raw.split(",") if r.strip()]
	return parsed or None


def _resolve_host(arg_value: str | None) -> str:
	return arg_value or os.getenv("GLANCE_HOST") or "127.0.0.1"


def _resolve_port(arg_value: int | None) -> int:
	if arg_value is not None:
		return arg_value
	env = os.getenv("GLANCE_PORT")
	if env:
		return int(env)
	return 8765


def _open_browser(url: str) -> None:
	time.sleep(0.6)
	try:
		webbrowser.open(url)
	except Exception:
		pass


def _cmd_serve(args: argparse.Namespace) -> int:
	workspace = _resolve_workspace(args.workspace, args.path)
	roots = _resolve_roots(args.roots)
	host = _resolve_host(args.host)
	port = _resolve_port(args.port)

	app = create_app(workspace, roots)
	url = f"http://{host}:{port}"
	print(f"glance {_version()} — workspace={workspace}")
	print(f"listening at {url}")

	if not args.no_browser and host in {"127.0.0.1", "localhost", "0.0.0.0"}:
		threading.Thread(target=_open_browser, args=(url,), daemon=True).start()

	uvicorn.run(app, host=host, port=port, log_level=args.log_level)
	return 0


def _cmd_version(_args: argparse.Namespace) -> int:
	print(f"glance {_version()}")
	return 0


def _cmd_update(_args: argparse.Namespace) -> int:
	uv = shutil.which("uv")
	if not uv:
		print("uv not found on PATH — install uv to use `glance update`.", file=sys.stderr)
		return 1
	print("Upgrading via `uv tool upgrade glance`...")
	result = subprocess.run([uv, "tool", "upgrade", "glance"])
	return result.returncode


SUBCOMMANDS = {"serve", "version", "update", "help"}


def _build_serve_parser(prog: str = "glance serve") -> argparse.ArgumentParser:
	p = argparse.ArgumentParser(
		prog=prog,
		description="Start the glance server in a workspace directory.",
	)
	p.add_argument("path", nargs="?", default=None, help="Workspace directory (defaults to cwd)")
	p.add_argument("--workspace", default=None, help="Workspace directory [env: GLANCE_WORKSPACE]")
	p.add_argument("--roots", default=None, help="Comma-separated root names [env: GLANCE_ROOTS]")
	p.add_argument("--host", default=None, help="Host to bind [env: GLANCE_HOST, default 127.0.0.1]")
	p.add_argument("--port", type=int, default=None, help="Port to bind [env: GLANCE_PORT, default 8765]")
	p.add_argument("--no-browser", action="store_true", help="Don't open browser on startup")
	p.add_argument(
		"--log-level",
		default="info",
		choices=["critical", "error", "warning", "info", "debug", "trace"],
	)
	return p


def _print_top_help() -> None:
	print(
		"glance — web-based file explorer for browsing repos\n"
		"\n"
		"Usage:\n"
		"  glance [path] [flags]       Start server (default command)\n"
		"  glance serve [path] [flags] Start server (explicit)\n"
		"  glance version              Show version\n"
		"  glance update               Upgrade via `uv tool upgrade glance`\n"
		"  glance help                 Show this help\n"
		"\n"
		"Serve flags:\n"
		"  --workspace PATH   Workspace directory [env: GLANCE_WORKSPACE]\n"
		"  --roots NAMES      Comma-separated root names [env: GLANCE_ROOTS]\n"
		"  --host HOST        Host to bind [env: GLANCE_HOST, default 127.0.0.1]\n"
		"  --port PORT        Port to bind [env: GLANCE_PORT, default 8765]\n"
		"  --no-browser       Don't open browser on startup\n"
		"  --log-level LEVEL  uvicorn log level (default info)\n"
	)


def main(argv: list[str] | None = None) -> int:
	raw = list(argv) if argv is not None else sys.argv[1:]

	if raw and raw[0] in {"-h", "--help", "help"}:
		_print_top_help()
		return 0
	if raw and raw[0] in {"-v", "--version"}:
		return _cmd_version(argparse.Namespace())

	if raw and raw[0] == "version":
		return _cmd_version(argparse.Namespace())
	if raw and raw[0] == "update":
		return _cmd_update(argparse.Namespace())

	if raw and raw[0] == "serve":
		raw = raw[1:]

	parser = _build_serve_parser()
	args = parser.parse_args(raw)
	return _cmd_serve(args)


if __name__ == "__main__":
	raise SystemExit(main())
