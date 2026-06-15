# UI for xTerm over WebSockets

## UI > Server Events

**Send user input:**

```json
{ "type": "input", "data": "string\n" }
```

**Send new terminal size:**

```json
{ "type": "resize", "data": { "cols": 80, "rows": 20 } }
```

**Terminate current session:**

```json
{ "type": "close" }
```

## Server > UI events

**Terminate current session:**

```json
{ "type": "close" }
```

**Print output:**

As string:

```json
{ "type": "stdout", "data": "string" }
```

As a Buffer:

```json
{ "type": "stdout", "data": { "type": "Buffer", "data": ["...Uint8 bytes"] } }
```
