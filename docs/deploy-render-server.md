# Deploying `elah serve`

`elah serve` is a long-running HTTP render server: it launches Chrome once at
startup and keeps it warm, so each `POST /render` only pays for a new tab
(milliseconds) instead of a fresh browser process (1–3s). See
[../docs/headless-server-gap-analysis.md](./headless-server-gap-analysis.md)
for the context this fills.

## Contract

| Route | Method | Behavior |
|---|---|---|
| `/healthz` | GET | `200 { "status": "ok", "browser": "connected" \| "disconnected" }` |
| `/render` | POST | Body = a [build spec](../packages/cli/README.md) JSON document. Blocks until the render finishes, then returns the MP4 bytes (`200`, `content-type: video/mp4`). |

Error responses are JSON `{ "error": "..." }`:

- `400` — request body is not valid JSON
- `413` — body exceeds the size limit (default 5 MB)
- `422` — spec failed validation or an asset couldn't be resolved/probed (path-addressed message, e.g. `clips[2].duration must be ...`)
- `500` — render failed (browser crash, timeout, internal error)
- `503` + `Retry-After: 5` — at capacity (`--concurrency`); retry the request

There is **no job queue** — `POST /render` is synchronous. A caller that gets
a 503 should retry with backoff; there is no queued/async variant in this
version.

## Docker

Build from the **repo root** (this is an npm workspace and the Dockerfile
needs the whole monorepo as context):

```sh
docker build -t elah-render -f packages/cli/Dockerfile .
docker run --rm -p 8080:8080 --shm-size=1g \
  -v /path/to/media:/media \
  elah-render --media-root /media --concurrency 2
```

```sh
curl http://127.0.0.1:8080/healthz
curl -X POST --data-binary @spec.json http://127.0.0.1:8080/render -o out.mp4
```

Flags after the image name are appended to `elah serve` (the entrypoint
already sets `--host 0.0.0.0 --port 8080`).

**No published image.** Google Chrome's EULA restricts redistribution of the
browser binary, so this repo ships the Dockerfile only — build it yourself.
The image is **amd64-only** (there is no Linux arm64 build of Chrome); on
Apple Silicon you'll be running under emulation.

`--shm-size=1g` matters: Chrome uses `/dev/shm` for its renderer process and
the Docker default (64 MB) is too small for anything beyond trivial exports.

## Bare Ubuntu (no Docker)

On Ubuntu 24.04:

```sh
# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Google Chrome (same repo the Dockerfile uses)
wget -qO- https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /usr/share/keyrings/google-linux.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-linux.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
  | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt-get update
sudo apt-get install -y google-chrome-stable fonts-liberation fonts-noto-core fonts-noto-color-emoji

git clone <this repo> && cd elah
npm ci
npm run build --workspace=packages/core
npm run build --workspace=packages/cli
ELAH_BROWSER=/usr/bin/google-chrome-stable node packages/cli/dist/bin.js serve --host 0.0.0.0 --port 8080
```

Optional systemd unit:

```ini
[Unit]
Description=elah render server
After=network.target

[Service]
Environment=ELAH_BROWSER=/usr/bin/google-chrome-stable
ExecStart=/usr/bin/node /opt/elah/packages/cli/dist/bin.js serve --host 0.0.0.0 --port 8080 --media-root /var/lib/elah/media
Restart=on-failure
User=elah

[Install]
WantedBy=multi-user.target
```

## Security

`elah serve` has **no authentication**. It binds `127.0.0.1` by default;
`elah serve --host 0.0.0.0` (what the Docker image does) prints a startup
warning. Only expose it on a trusted network — behind your own API gateway
or a private VPC, not directly on the public internet.

Spec `assets` may be an `http(s)://` URL, an absolute path, or a path
relative to `--media-root`. There's no path allowlisting: this is meant to
sit behind a trusted backend (the thing generating the specs), not to accept
untrusted specs directly from end users.

## GPU / performance

Headless Chrome falls back to software video encoding without GPU flags —
correct but slow. GPU acceleration is out of scope for this version; if
render throughput matters, benchmark on the target hardware and consider
running multiple `elah serve` replicas behind a load balancer (each with its
own warm Chrome) rather than tuning a single instance.
