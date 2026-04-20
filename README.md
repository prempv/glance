# glance

Web-based file explorer for browsing a directory of repos. Run `glance` in any folder and it serves a local web UI with tree navigation, file view, and search.

## Install

Installed from GitHub (no PyPI) using [uv](https://github.com/astral-sh/uv):

```bash
uv tool install git+https://github.com/prempv/glance
```

Pin to a specific release:

```bash
uv tool install git+https://github.com/prempv/glance@v0.1.0
```

## Usage

```bash
glance                        # serve cwd at http://127.0.0.1:8765
glance /path/to/workspace     # serve a specific path
glance --port 5554 --host 0.0.0.0 --no-browser
glance version                # print version
glance update                 # upgrade via `uv tool upgrade glance`
```

### Configuration

Every flag has an environment-variable fallback. Precedence is **flag > env > default**.

| Flag | Env var | Default |
|---|---|---|
| `--workspace` (or positional) | `GLANCE_WORKSPACE` | `cwd` |
| `--roots` (comma-separated) | `GLANCE_ROOTS` | auto-discovered top-level dirs |
| `--host` | `GLANCE_HOST` | `127.0.0.1` |
| `--port` | `GLANCE_PORT` | `8765` |
| `--no-browser` | — | open browser on startup |

## Development

```bash
uv sync
uv run glance --port 5555
```

## License

MIT
