# MokuMoku

MokuMoku is a real-time board game collection for EdgeOne Pages. It supports Gomoku, Go, Reversi, and Connect6 with public matchmaking, private rooms, and browser-side AI opponents.

## Features

- Gomoku, Go, Reversi, and Connect6.
- Public matchmaking and private room codes.
- AI matches for all games.
- Online player count, move timer, restart, color-swap restart, pass, and resign.
- Browser-side AI, with a Web Worker for Go MCTS search.

## How It Works

The app is a static frontend backed by EdgeOne Pages Cloud Functions.

- `index.html`, `styles.css`, and `script.js` render the UI and game board.
- `script.js` sends actions to `/api/game` and polls `/api/game` for room state.
- `cloud-functions/api/game.js` handles matchmaking, rooms, rules, scoring, and game state.
- `cloud-functions/api/presence.js` tracks online players.
- `cloud-functions/api/internal/cleanup.js` cleans stale Blob data.
- `ai.js` and `go-mcts-worker.js` run browser-side AI.

Game state is stored in the `gomoku-game-state` Blob store through `@edgeone/pages-blob`.

## Project Structure

```text
.
|-- index.html
|-- styles.css
|-- script.js
|-- ai.js
|-- go-mcts-worker.js
|-- edgeone.json
|-- cloud-functions/
|   `-- api/
|       |-- game.js
|       |-- presence.js
|       |-- internal/
|       |   `-- cleanup.js
|       `-- ws.js
|-- tests/
|   `-- rules.test.js
`-- package.json
```

## Local Development

```bash
npm install
export PAGES_SOURCE=skills
edgeone pages dev
```

Open:

```text
http://localhost:8088/
```

## Deployment

Deploy with EdgeOne Pages. The `cloud-functions/` directory contains the API routes used by the frontend.

## Scheduled Cleanup

`edgeone.json` registers `blob-cleanup`, which calls `POST /api/internal/cleanup` once per day at `03:15 UTC`.

## Tests

```bash
npm run check
npm test
```
