# Intent

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

## UI Intent

- Favor purposeful, readable visuals over generic admin UI.
- Keep the controller modern and slightly futuristic without becoming noisy or hard to use.
- Make the overlay animation feel deliberate and energetic, not timid or purely utilitarian.
- Prioritize legibility of game names and stream-state clarity over decorative complexity.
