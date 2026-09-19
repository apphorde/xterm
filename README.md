# xterm

The image supports two deployment modes.

## UI

The default mode serves the authenticated server picker and terminal UI from
`/dist`:

```sh
docker run --rm -p 3000:3000 ghcr.io/apphorde/xterm:latest
```

## Terminal Server

Run the same image on a machine that should expose a local shell over the
websocket protocol:

```sh
docker run --rm \
  -e APP_MODE=terminal \
  -e WS_AUTH_KEY='replace-with-a-secret' \
  -p 8000:8000 \
  ghcr.io/apphorde/xterm:latest
```

The terminal server exposes `POST /auth` to exchange the configured key for a
single-use websocket token. Tokens expire after one minute.

The UI proxies these connections through its own origin after checking the
user's saved server property. This keeps endpoint DNS and CORS concerns on the
UI server.

## Standalone Terminal Agent

The websocket side is also a standalone Node.js process. On a Raspberry Pi,
Android/Termux, or another host with Node.js and a compiler toolchain:

```sh
pnpm install
WS_AUTH_KEY='replace-with-a-secret' PORT=8000 pnpm run terminal
```

This is the recommended extraction boundary if the terminal agent is later
published as its own small package. The UI and agent continue to share the
same `/auth` and websocket message protocol.
