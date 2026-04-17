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

## Tests

```bash
npm test
```
