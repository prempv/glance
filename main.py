import os
from pathlib import Path
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

WORKSPACE = Path("/home/ubuntu/scx/work")
ROOTS = ["scx-platform", "swiftcx-engine"]
VIEWABLE_EXTENSIONS = {".py", ".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".cfg", ".ini", ".sh", ".bash", ".js", ".ts", ".tsx", ".jsx", ".css", ".html", ".sql", ".env", ".gitignore", ".dockerignore", "Dockerfile"}
SKIP_DIRS = {".git", "__pycache__", "node_modules", ".venv", "venv", ".mypy_cache", ".pytest_cache", ".ruff_cache", "dist", "build", ".next", ".nuxt"}

app = FastAPI()


def build_tree(root_path: Path, rel_prefix: str = "") -> list[dict]:
    entries = []
    try:
        items = sorted(root_path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    except PermissionError:
        return entries

    for item in items:
        if item.name in SKIP_DIRS or item.name.startswith(".") and item.is_dir():
            continue
        rel = f"{rel_prefix}/{item.name}" if rel_prefix else item.name
        if item.is_dir():
            entries.append({"name": item.name, "path": rel, "type": "dir", "children": None})
        else:
            ext = item.suffix.lower()
            if ext in VIEWABLE_EXTENSIONS or item.name in VIEWABLE_EXTENSIONS:
                entries.append({"name": item.name, "path": rel, "type": "file", "ext": ext})
    return entries


@app.get("/api/roots")
def get_roots():
    roots = []
    for name in ROOTS:
        p = WORKSPACE / name
        if p.is_dir():
            roots.append({"name": name, "path": name, "type": "dir", "children": None})
    worktrees = WORKSPACE / "worktrees"
    if worktrees.is_dir():
        for wt in sorted(worktrees.iterdir()):
            if wt.is_dir():
                roots.append({"name": f"worktrees/{wt.name}", "path": f"worktrees/{wt.name}", "type": "dir", "children": None})
    return roots


@app.get("/api/tree")
def get_tree(path: str = Query(...)):
    full = (WORKSPACE / path).resolve()
    if not str(full).startswith(str(WORKSPACE)):
        raise HTTPException(403, "Access denied")
    if not full.is_dir():
        raise HTTPException(404, "Not a directory")
    return build_tree(full, path)


@app.get("/api/file")
def get_file(path: str = Query(...)):
    full = (WORKSPACE / path).resolve()
    if not str(full).startswith(str(WORKSPACE)):
        raise HTTPException(403, "Access denied")
    if not full.is_file():
        raise HTTPException(404, "File not found")
    try:
        size = full.stat().st_size
        if size > 2_000_000:
            raise HTTPException(413, "File too large (>2MB)")
        content = full.read_text(errors="replace")
        return {"path": path, "name": full.name, "ext": full.suffix.lower(), "content": content, "size": size}
    except UnicodeDecodeError:
        raise HTTPException(415, "Binary file")


@app.get("/api/search")
def search_files(q: str = Query(..., min_length=1)):
    q_lower = q.lower()
    results = []
    for root_name in ROOTS:
        root = WORKSPACE / root_name
        if not root.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
            for fname in filenames:
                if q_lower in fname.lower():
                    fp = Path(dirpath) / fname
                    ext = fp.suffix.lower()
                    if ext in VIEWABLE_EXTENSIONS or fname in VIEWABLE_EXTENSIONS:
                        rel = str(fp.relative_to(WORKSPACE))
                        results.append({"name": fname, "path": rel, "ext": ext})
                        if len(results) >= 50:
                            return results
    return results


app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True), name="static")
