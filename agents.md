# Intent

This project is a self-hosted stream tool for managing "The Docket" — a Twitch viewer-driven elimination/restore wheel that determines what game the streamer plays next.

## Product Intent

- Keep the workflow simple enough for a non-technical streamer to run with minimal setup on a Google Cloud VM.
- Let the streamer control everything from a browser page and use an OBS browser source for the on-stream overlay.
- Let viewers spend channel points to eliminate or restore games from the wheel, building anticipation for the next-game spin.
- Replace manual spreadsheet edits and third-party wheel sites with one shared source of truth.
- Make queueing and spinning feel fast and show-ready, with strong visual feedback for restores, eliminations, and next-game spins.
- Keep viewer-facing state live and readable through a public page.

## Technical Intent

- Prefer a single local Node.js app over a distributed/cloud-first system.
- Initial delivery targets a small always-on Google Cloud VM plus managed Postgres (e.g. Neon), while preserving a clean path back to streamer-local hosting later.
- Prefer plain JavaScript and avoid heavy frontend frameworks unless a later need clearly justifies them.
- Keep persistence simple and inspectable with local files first.
- Keep storage swappable between local files and hosted Postgres so the app can move between streamer-local hosting and lightweight hosted environments without rewriting core behavior.
- Keep file-backed storage bounded and observable so request/storage-limited hosts cannot quietly bloat over time.
- Keep the queue and spin resolution server-authoritative so overlay visuals never decide the real outcome.
- Leave clean seams for future Twitch integration without making Twitch a requirement for local testing.

## Hosting Constraints

The target deployment is a **free-tier Google Cloud VM** with a hard monthly egress budget (roughly 1 GB/month). WebSocket bandwidth must be treated as a scarce resource.

Design rules for keeping bandwidth low:

- **Event-driven only**: the server broadcasts only when state changes. No polling, no heartbeat that sends full state.
- **Compression**: WebSocket messages use `perMessageDeflate`. This alone reduces JSON traffic by 60–80%.
- **Minimal payloads per role**: each client role gets only what it needs.
  - Controller: games, queue, active spin, session, wheel config, storage summary. The spin history array is excluded — it can reach thousands of entries but the controller UI does not display it.
  - Overlay / public: games, active spin, last completed spin, wheel config.
- **Connections are decoupled from state**: connection-count changes are sent as a separate tiny `{ type: "connections" }` message so that viewer page loads and OBS browser-source reconnects do not trigger a full controller state dump.
- **Change detection**: the server caches the last serialized payload per role and skips sending if nothing changed.

When adding new fields to any snapshot or broadcast, evaluate whether the receiving client actually renders them. Unused fields in broadcast messages are wasted egress.

## Special Board Items

The wheel has two configurable special entries alongside regular games:

### Viewers Choice (`special-viewers-choice`)
- Appears on **both** the eliminate (in-scope) and restore (out-scope) wheels (`wheelScope: "both"` in `data/special-entries.json`).
- When it wins on the **restore wheel**: the controller shows a selector of "out" games. The streamer picks one to restore.
- When it wins on the **eliminate wheel**: the controller shows a selector of unlocked "in" games. The streamer picks one to eliminate.
- Locked "in" games are excluded from the Viewers Choice selector on the eliminate side (can't eliminate a locked game).
- Resolved via `POST /api/spins/viewers-choice` with `{ gameId }`.

### Locked Games
- Any "in" game can be manually locked via the game tile lock button in the controller (hover to reveal, gold when active).
- One game at a time can be locked; locking a new game unlocks all others.
- Locked via `POST /api/games/:id/lock` (toggles lock state).
- **A locked game cannot be eliminated**: `applyWinner` and `resolveViewersChoice` skip the status change if `game.locked`.
- **A locked game stays on the wheel but at half weight**: `buildEligibleEntries` uses `ceil(baseWeight * 0.5)` (minimum 1) for locked games.
- Lock is cleared when a game is restored (`applyWinner` sets `game.locked = false` on restore).
- Lock-It-In also sets a game's locked flag when the streamer resolves the selector.

### Lock It In and Re-spin (`special-lock-it-in`)
- Appears on the eliminate/next-game wheel (in-scope).
- When it wins, the controller shows a selector of unlocked "in" games. The streamer picks one to lock.
- If no lockable games exist, the special entry resolves as a no-op (panel still shows a Skip button).
- Resolved via `POST /api/spins/lock-it-in` with `{ gameId }`, or skipped via `POST /api/spins/lock-it-in-skip`.
- After resolving: a short lock-reveal animation plays on the overlay (CSS padlock icon, gold theme, ~3.5 s), then the wheel re-spins automatically without the lock-it-in entry.
- Cooldown: `wheelConfig.lockItInCooldownRounds` (default 0) controls how many eliminate spins after the re-spin before lock-it-in is eligible again. 0 = back on the next round after the re-spin.
- Cooldown is tracked in `session.lockItInCooldownRemaining`. The decrement happens when a new "in"-scope spin is created, *after* building the entry list for that spin.

### Overlay Hidden
- `POST /api/overlay/hidden` toggles `session.overlayHidden` (persisted).
- The public snapshot includes `overlayHidden`; the overlay applies a `.overlay-hidden` CSS class that fades and hides the stage.
- The controller lock-it-in panel exposes a "Hide Overlay / Show Overlay" button for this.

## UI Intent

- Favor purposeful, readable visuals over generic admin UI.
- Keep the controller modern and slightly futuristic without becoming noisy or hard to use.
- Make the overlay animation feel deliberate and energetic, not timid or purely utilitarian.
- Prioritize legibility of game names and stream-state clarity over decorative complexity.
