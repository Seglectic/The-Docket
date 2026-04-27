# The Docket

**The Docket** is a Twitch streamer tool for managing a randomized game selection wheel. Viewers spend channel points to spin a "vote wheel" that either **eliminates** or **restores** games from a tracked list. When the streamer is ready to pick what to play next, they spin the main wheel and the remaining games compete for the slot.

The tool replaces manual spreadsheets and third-party wheel sites with a single self-hosted app that keeps everyone — streamer, viewers, and OBS — in sync.

## Pages

| Page | URL | Audience |
|---|---|---|
| Controller | `/controller` | Streamer only (password-protected) |
| Overlay | `/overlay` | OBS browser source |
| Public | `/public` | Viewers in browser |

- The **controller** is the streamer's dashboard: add/edit games, manage the queue, trigger spins, tune wheel physics.
- The **overlay** is a canvas-based animated wheel rendered inside OBS as a browser source.
- The **public page** shows a live read-only view of which games are in or out.

All three update in real time via WebSocket.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the example config:

```bash
cp config/config.example.yaml config/config.yaml
```

3. Update `config/config.yaml`, especially `auth.sharedSecret`.
4. Start the app:

```bash
npm start
```

## Storage Modes

The app can run with either local files or Postgres as its source of truth.

- `storage.driver: "file"` keeps the current local-first behavior and writes runtime state into `data/`.
- `storage.driver: "postgres"` stores runtime state in Postgres and is the intended mode for hosted deployments.
- If `storage.driver` is omitted, the app falls back to Postgres automatically when `POSTGRES_URL` or `DATABASE_URL` is present. Otherwise it uses file storage.

Example Postgres config:

```yaml
storage:
  driver: "postgres"
  postgres:
    connectionString: ""
    ssl: true
```

You can also leave `connectionString` blank and rely on `POSTGRES_URL` or `DATABASE_URL`. The app accepts either automatically.

## Google Cloud VM

The current deployment target is a small always-on Google Cloud VM with an external Postgres database such as Neon. This fits the app better than serverless hosts because the app runs as a persistent Node server and uses WebSockets for live controller / overlay updates.

Minimal VM env setup:

```bash
DOCKET_STORAGE_DRIVER=postgres
DATABASE_URL=<from Neon>
AUTH_SHARED_SECRET=<controller shared secret>
HOST=0.0.0.0
PORT=3030
```

Notes:

- The app respects `HOST`, `PORT`, `DATABASE_URL`, and `AUTH_SHARED_SECRET` directly from the environment.
- If `DATABASE_URL` is present, the app can use Postgres without needing a checked-in `config.yaml`.
- `npm start` is the default runtime entrypoint for this project.
- A reverse proxy such as Caddy can expose `/controller`, `/overlay`, and `/public` over HTTPS while the Node app listens on a local port.

## Bandwidth

This app is hosted on a free-tier Google Cloud VM with a hard monthly egress limit. WebSocket traffic must be kept small.

The server only broadcasts when state actually changes (event-driven, not polling). Broadcast messages use per-message deflate compression and carry only the data each client role needs:

- **Controller** messages: games, queue, active spin, session, wheel config, storage summary. Spin history is excluded — it can grow to thousands of entries and the controller UI does not display it.
- **Public / overlay** messages: games, active spin, last completed spin, wheel config.
- **Connection count** updates are sent as a separate lightweight `{ type: "connections" }` message so that viewer page loads and OBS reconnects do not trigger a full state broadcast to the controller.

If you are testing and notice bandwidth growing quickly, check:
1. Whether the OBS browser source is set to refresh frequently.
2. Whether multiple browser tabs are left open to `/public` (each is a persistent WebSocket connection).
3. Whether the controller is open in multiple tabs.

## Live Deploy Flow

The GCP VM should be treated as the live environment.

- Do regular work on a non-`main` branch such as `develop`.
- Merge to `main` only when a change is ready for live.
- A GitHub Actions workflow on `main` runs `npm test`, SSHes into the VM, pulls `main`, installs production dependencies, and restarts `the-docket.service`.

The deploy workflow uses these GitHub Actions secrets:

- `LIVE_DEPLOY_SSH_KEY`
- `LIVE_HOST`
- `LIVE_KNOWN_HOSTS`
- `LIVE_USER`

## Notes

- Runtime data is created in `data/` on first run.
- The same app works locally on one machine or across a LAN.
- OBS should use the `/overlay` URL as a browser source.
- The controller uses a shared-secret login and stores a session cookie locally.
- Storage is intentionally bounded for lightweight hosting targets:
  - `data/events.jsonl` is pruned to roughly the last 6 months.
  - `data/spins.json` keeps recent history only and drops older spin sessions.
  - `data/media/covers/` is trimmed automatically with a 512 MB cache ceiling and a per-image size cap.
  - The controller header shows total app storage usage against a 1 GB budget.
- Remote game cover URLs are stored as-is. The app does not download and re-host cover art during normal game saves.

## Game Lookup

The game add form supports optional IGDB-powered autocomplete and cover fill.

- The easiest setup path is now in the controller under `Games -> Game Database`.
- Use the built-in links to open:
  - Twitch developer app registration
  - IGDB docs
- Paste your Twitch app `clientId` and `clientSecret` into the controller form and save.
- The game title field will then search IGDB and let you pick a result to auto-fill the cover art.

Runtime notes:

- Search results are cached locally in `data/game-db-cache.json`.
- Saved IGDB runtime settings are stored locally in `data/game-db-settings.json`.
- If IGDB is not configured, the add-game form still works manually.
- Search cache writes are already bounded to the newest 150 queries.
- In Postgres mode, the same game DB cache/settings live in the database instead of local files.

## Twitch EventSub

For Twitch channel-point redeems, the recommended local-first transport is EventSub over WebSockets.

Why:

- Webhook EventSub requires a publicly reachable HTTPS callback.
- WebSocket EventSub works well for local installs and self-hosted streamer setups.
- Channel point redemption subscriptions require streamer authorization, so this part does need a real Twitch OAuth login flow later.

Recommended setup model for this app:

- Use Twitch OAuth redirect in the controller for the streamer account.
- Store the resulting user token server-side.
- Open an EventSub WebSocket session from the server.
- Subscribe to redemption events for the streamer's broadcaster ID.

Config fields reserved for this flow live in `config/config.yaml` under `twitch`.

Current implementation status:

- The controller can now start the Twitch OAuth authorization-code flow.
- The callback is handled at `/auth/twitch/callback`.
- The resulting streamer token is stored locally in `data/twitch-auth.json`.
- EventSub subscription management is the next step.

Important distinction:

- `gameDatabase` / IGDB search uses app credentials and does not need a browser login redirect.
- `twitch` / EventSub channel-point ingestion does need a browser login redirect because channel redemptions require broadcaster authorization.

Planned EventSub subscriptions for this project:

- `channel.channel_points_custom_reward_redemption.add`
- optionally `channel.channel_points_custom_reward_redemption.update`
- optionally `channel.channel_points_automatic_reward_redemption.add` v2

Minimal Twitch app registration steps:

1. Create or use a Twitch account and enable 2FA.
2. Register a Twitch application in the developer console.
3. Use `http://localhost:3030/auth/twitch/callback` as a redirect URL for local development.
4. Set the app type so you can generate a client secret.
5. Put the client ID and secret in `config/config.yaml` under `twitch.app`.
6. Sign in through the controller so the app can obtain a user token with the needed redemption scope.

Minimal local Twitch config:

```yaml
twitch:
  enabled: true
  broadcasterLogin: "your_channel_login"
  scopes: "channel:read:redemptions"
  app:
    clientId: "your-client-id"
    clientSecret: "your-client-secret"
    redirectUri: "http://localhost:3030/auth/twitch/callback"
```

## Wheel Feel Tuning

You can tune the wheel in three places:

- Controller UI: `Active Spin -> Wheel Feel`
- Runtime file: `data/wheel-config.json`
- Default config for fresh installs: `config/config.yaml`

Recommended meaning of the main wheel knobs:

- `wheel.physics.wheelMass`: heavier wheel, more inertia
- `wheel.physics.launchForce`: harder kick into speed
- `wheel.physics.drag`: more drag means it sheds speed faster
- `wheel.physics.brakeStrength`: stronger final settle onto the winner
- `wheel.physics.minCruiseMs`: minimum time spent at high speed
- `wheel.physics.revealDelayMs`: delay after stop before the winner card appears

Important behavior:

- `config/config.yaml` seeds defaults for new installs / new data directories.
- Once the app has created `data/wheel-config.json`, that runtime file becomes the active source of truth for wheel feel.
- If you want to re-seed from `config/config.yaml`, delete `data/wheel-config.json` while the app is stopped and restart it.

## Tests

```bash
npm test
```
