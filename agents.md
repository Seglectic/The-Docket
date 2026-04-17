# Intent

This project is a local-first stream tool for managing "The Docket" without Google Sheets or third-party wheel sites.

## Product Intent

- Keep the workflow simple enough for a small streamer to run locally on their own machine.
- Let the streamer control everything from a browser page and use an OBS browser source for the on-stream overlay.
- Replace manual spreadsheet edits and manual wheel maintenance with one shared source of truth.
- Make queueing and spinning feel fast and show-ready, with strong visual feedback for restores, eliminations, and next-game spins.
- Keep viewer-facing state live and readable through a public page.

## Technical Intent

- Prefer a single local Node.js app over a distributed/cloud-first system.
- Prefer plain JavaScript and avoid heavy frontend frameworks unless a later need clearly justifies them.
- Keep persistence simple and inspectable with local files first.
- Keep the queue and spin resolution server-authoritative so overlay visuals never decide the real outcome.
- Leave clean seams for future Twitch integration without making Twitch a requirement for local testing.

## UI Intent

- Favor purposeful, readable visuals over generic admin UI.
- Keep the controller modern and slightly futuristic without becoming noisy or hard to use.
- Make the overlay animation feel deliberate and energetic, not timid or purely utilitarian.
- Prioritize legibility of game names and stream-state clarity over decorative complexity.
