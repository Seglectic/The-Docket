# Hosting

## Environment

The production deployment is a free-tier Google Cloud e2-micro VM (us-west1) running:
- Node.js app via `the-docket.service` (systemd, user `khal`)
- Caddy reverse proxy on port 80 (HTTP only; TLS terminated at Cloudflare)
- Cloudflare Tunnel (`cloudflared`) for all public ingress — the VM has no `http-server` or `https-server` firewall tags and should not

Access flows through the Cloudflare tunnel only. Direct VM port exposure should never be re-enabled.

## Billing Guard

A GCP billing budget is set with a $1/month cap. A Cloud Function (`stopBilling`) fires via Pub/Sub when spend reaches 100% of that threshold, automatically disabling billing on the project. This effectively shuts down the VM if any charges accrue. Threshold alerts also fire at 50% and 90% spend, and at 100% forecasted spend.

The free-tier e2-micro includes 1 GB egress/month to North America. Overage is ~$0.08/GB. The billing guard ensures any overage beyond ~$1 kills the project rather than running up a bill.

## Egress Budget

The hard monthly egress budget is roughly 1 GB. WebSocket bandwidth must be treated as a scarce resource.

Design rules for keeping bandwidth low:

- **Event-driven only**: the server broadcasts only when state changes. No polling, no heartbeat that sends full state.
- **Compression**: WebSocket messages use `perMessageDeflate`. This alone reduces JSON traffic by 60–80%.
- **Minimal payloads per role**: each client role gets only what it needs.
  - Controller: games, queue, active spin, session, wheel config, storage summary. The spin history array is excluded — it can reach thousands of entries but the controller UI does not display it.
  - Overlay / public: games, active spin, last completed spin, wheel config.
- **Connections are decoupled from state**: connection-count changes are sent as a separate tiny `{ type: "connections" }` message so that viewer page loads and OBS browser-source reconnects do not trigger a full controller state dump.
- **Change detection**: the server caches the last serialized payload per role and skips sending if nothing changed.

When adding new fields to any snapshot or broadcast, evaluate whether the receiving client actually renders them. Unused fields in broadcast messages are wasted egress.

## Live Ops Notes

- Caddy keeps access logging enabled at `/var/log/caddy/access.log` (rolling, 10 MiB, 10 files). This is the primary source for attributing unexpected traffic — the Node app does not emit request logs by default.
- Tunnel-originated requests arrive from `127.0.0.1` with Cloudflare headers (`CF-Connecting-IP`, `X-Forwarded-For`). Use those headers when investigating real client origin.
- If bandwidth looks unexpectedly high, check:
  - Whether direct public ingress has been re-enabled by restoring `http-server` / `https-server` firewall tags.
  - Whether public, overlay, or controller tabs were left open and maintaining WebSocket sessions.
  - Whether bot traffic in the access log is repeatedly fetching `/public`, `/api/public-state`, or `/ws`.
