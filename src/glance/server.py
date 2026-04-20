from __future__ import annotations

import os
from importlib.resources import as_file, files
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles

VIEWABLE_EXTENSIONS = {
	".py", ".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".cfg", ".ini",
	".sh", ".bash", ".js", ".ts", ".tsx", ".jsx", ".css", ".html", ".sql",
	".env", ".gitignore", ".dockerignore", "Dockerfile",
}
SKIP_DIRS = {
	".git", "__pycache__", "node_modules", ".venv", "venv", ".mypy_cache",
	".pytest_cache", ".ruff_cache", "dist", "build", ".next", ".nuxt",
}


def _discover_roots(workspace: Path) -> list[str]:
	return [
		d.name
		for d in sorted(workspace.iterdir())
		if d.is_dir() and not d.name.startswith(".") and d.name != "worktrees"
	]


def _file_visible(name: str, ext: str, show_hidden: bool) -> bool:
	if name.startswith("."):
		return show_hidden or name in VIEWABLE_EXTENSIONS
	return ext in VIEWABLE_EXTENSIONS or name in VIEWABLE_EXTENSIONS


def _build_tree(root_path: Path, rel_prefix: str = "", show_hidden: bool = False) -> list[dict]:
	entries: list[dict] = []
	try:
		items = sorted(root_path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
	except PermissionError:
		return entries

	for item in items:
		if item.name in SKIP_DIRS or (item.name.startswith(".") and item.is_dir()):
			continue
		rel = f"{rel_prefix}/{item.name}" if rel_prefix else item.name
		if item.is_dir():
			entries.append({"name": item.name, "path": rel, "type": "dir", "children": None})
		else:
			ext = item.suffix.lower()
			if _file_visible(item.name, ext, show_hidden):
				entries.append({"name": item.name, "path": rel, "type": "file", "ext": ext})
	return entries


def _all_roots(workspace: Path, configured: list[str]) -> list[str]:
	roots = list(configured)
	worktrees = workspace / "worktrees"
	if worktrees.is_dir():
		for wt in sorted(worktrees.iterdir()):
			if wt.is_dir():
				roots.append(f"worktrees/{wt.name}")
	return roots


def create_app(workspace: Path, roots: list[str] | None = None) -> FastAPI:
	workspace = workspace.resolve()
	if not workspace.is_dir():
		raise RuntimeError(f"workspace not found: {workspace}")
	configured_roots = roots or _discover_roots(workspace)

	app = FastAPI(title="glance")

	@app.middleware("http")
	async def no_cache_api(request, call_next):
		response = await call_next(request)
		if request.url.path.startswith("/api/"):
			response.headers["Cache-Control"] = "no-store"
		return response

	@app.get("/api/roots")
	def get_roots():
		out = []
		for name in configured_roots:
			p = workspace / name
			if p.is_dir():
				out.append({"name": name, "path": name, "type": "dir", "children": None})
		worktrees = workspace / "worktrees"
		if worktrees.is_dir():
			for wt in sorted(worktrees.iterdir()):
				if wt.is_dir():
					out.append({
						"name": f"worktrees/{wt.name}",
						"path": f"worktrees/{wt.name}",
						"type": "dir",
						"children": None,
					})
		return out

	@app.get("/api/tree")
	def get_tree(path: str = Query(...), show_hidden: bool = Query(False)):
		full = (workspace / path).resolve()
		if not str(full).startswith(str(workspace)):
			raise HTTPException(403, "Access denied")
		if not full.is_dir():
			raise HTTPException(404, "Not a directory")
		return _build_tree(full, path, show_hidden)

	@app.get("/api/file")
	def get_file(path: str = Query(...)):
		full = (workspace / path).resolve()
		if not str(full).startswith(str(workspace)):
			raise HTTPException(403, "Access denied")
		if not full.is_file():
			raise HTTPException(404, "File not found")
		try:
			size = full.stat().st_size
			if size > 2_000_000:
				raise HTTPException(413, "File too large (>2MB)")
			content = full.read_text(errors="replace")
			return {
				"path": path,
				"name": full.name,
				"ext": full.suffix.lower(),
				"content": content,
				"size": size,
			}
		except UnicodeDecodeError:
			raise HTTPException(415, "Binary file")

	@app.get("/api/search")
	def search_files(
		q: str = Query(..., min_length=1),
		roots: str = Query("", description="Comma-separated root names to search"),
		ext: str = Query("", description="Extension filter, e.g. .py or .md"),
		show_hidden: bool = Query(False),
	):
		q_lower = q.lower()
		ext_filter = ext.lower().strip() if ext else ""
		requested = [r.strip() for r in roots.split(",") if r.strip()] if roots else configured_roots
		valid = _all_roots(workspace, configured_roots)
		search_roots = [r for r in requested if r in valid] or configured_roots

		results: list[dict] = []
		for root_name in search_roots:
			root = workspace / root_name
			if not root.is_dir():
				continue
			for dirpath, dirnames, filenames in os.walk(root):
				dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
				for fname in filenames:
					if q_lower not in fname.lower():
						continue
					fp = Path(dirpath) / fname
					file_ext = fp.suffix.lower()
					if ext_filter and file_ext != ext_filter:
						continue
					if _file_visible(fname, file_ext, show_hidden):
						rel = str(fp.relative_to(workspace))
						results.append({"name": fname, "path": rel, "ext": file_ext})
						if len(results) >= 50:
							return results
		return results

	static_ref = files(__package__).joinpath("static")
	with as_file(static_ref) as static_path:
		app.mount("/", StaticFiles(directory=str(static_path), html=True), name="static")

	return app
