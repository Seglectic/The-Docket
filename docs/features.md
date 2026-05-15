# Special Board Items

The wheel has two configurable special entries alongside regular games:

## Viewers Choice (`special-viewers-choice`)

- Appears on **both** the eliminate (in-scope) and restore (out-scope) wheels (`wheelScope: "both"` in `data/special-entries.json`).
- When it wins on the **restore wheel**: the controller shows a selector of "out" games. The streamer picks one to restore.
- When it wins on the **eliminate wheel**: the controller shows a selector of unlocked "in" games. The streamer picks one to eliminate.
- Locked "in" games are excluded from the Viewers Choice selector on the eliminate side (can't eliminate a locked game).
- Resolved via `POST /api/spins/viewers-choice` with `{ gameId }`.

## Locked Games

- Any "in" game can be manually locked via the game tile lock button in the controller (hover to reveal, gold when active).
- One game at a time can be locked; locking a new game unlocks all others.
- Locked via `POST /api/games/:id/lock` (toggles lock state).
- **A locked game cannot be eliminated**: `applyWinner` and `resolveViewersChoice` skip the status change if `game.locked`.
- **A locked game stays on the wheel but at half weight**: `buildEligibleEntries` uses `ceil(baseWeight * 0.5)` (minimum 1) for locked games.
- Lock is cleared when a game is restored (`applyWinner` sets `game.locked = false` on restore).
- Lock-It-In also sets a game's locked flag when the streamer resolves the selector.

## Lock It In and Re-spin (`special-lock-it-in`)

- Appears on the eliminate/next-game wheel (in-scope).
- When it wins, the controller shows a selector of unlocked "in" games. The streamer picks one to lock.
- If no lockable games exist, the special entry resolves as a no-op (panel still shows a Skip button).
- Resolved via `POST /api/spins/lock-it-in` with `{ gameId }`, or skipped via `POST /api/spins/lock-it-in-skip`.
- After resolving: a short lock-reveal animation plays on the overlay (CSS padlock icon, gold theme, ~3.5 s), then the wheel re-spins automatically without the lock-it-in entry.
- Cooldown: `wheelConfig.lockItInCooldownRounds` (default 0) controls how many eliminate spins after the re-spin before lock-it-in is eligible again. 0 = back on the next round after the re-spin.
- Cooldown is tracked in `session.lockItInCooldownRemaining`. The decrement happens when a new "in"-scope spin is created, *after* building the entry list for that spin.

## Overlay Hidden

- `POST /api/overlay/hidden` toggles `session.overlayHidden` (persisted).
- The public snapshot includes `overlayHidden`; the overlay applies a `.overlay-hidden` CSS class that fades and hides the stage.
- The controller lock-it-in panel exposes a "Hide Overlay / Show Overlay" button for this.
