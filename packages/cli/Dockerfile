# Headless render server for @elah/cli.
#
# Build from the REPO ROOT (this is an npm workspace):
#   docker build -t elah-render -f packages/cli/Dockerfile .
#
# Run:
#   docker run --rm -p 8080:8080 --shm-size=1g \
#     -v /path/to/media:/media elah-render --media-root /media
#
# Not published to a registry on purpose — Google Chrome's EULA restricts
# redistribution of the browser binary, so each deployer builds their own
# image. See docs/deploy-render-server.md for the full story (fonts, GPU,
# bare-metal alternative, security notes).

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build --workspace=packages/core && npm run build --workspace=packages/cli
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

# Branded Chrome (not Playwright's bundled Chromium) is required: the
# bundled Chromium lacks the proprietary H.264/AAC codecs the default
# export path uses. fonts-liberation/fonts-noto-* keep text clips from
# rendering with missing-glyph boxes on a bare container.
RUN apt-get update && apt-get install -y --no-install-recommends \
      wget gnupg ca-certificates \
    && wget -qO- https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-linux.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-linux.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
      > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update && apt-get install -y --no-install-recommends \
      google-chrome-stable \
      fonts-liberation \
      fonts-noto-core \
      fonts-noto-color-emoji \
    && apt-get purge -y wget gnupg \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Deterministic browser selection — skips channel discovery.
ENV ELAH_BROWSER=/usr/bin/google-chrome-stable

WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json* /app/
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages

# Non-root. Playwright's chromium.launch() already defaults chromiumSandbox
# to false (passes --no-sandbox), so no code change is needed here. If a
# container ever fails to launch with a sandbox/zygote error, the fallback
# is to set `chromiumSandbox: false` explicitly in src/lib/browser.ts.
RUN useradd --create-home --shell /usr/sbin/nologin elah \
    && chown -R elah:elah /app
USER elah

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["node", "/app/packages/cli/dist/bin.js", "serve", "--host", "0.0.0.0", "--port", "8080"]
CMD []
