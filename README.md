# The Docket

Local-first docket manager for stream wheel spins. One Node.js process serves:

- `http://localhost:3030/controller`
- `http://localhost:3030/overlay`
- `http://localhost:3030/public`

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

## Notes

- Runtime data is created in `data/` on first run.
- The same app works locally on one machine or across a LAN.
- OBS should use the `/overlay` URL as a browser source.
- The controller uses a shared-secret login and stores a session cookie locally.

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
