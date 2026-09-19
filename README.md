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
