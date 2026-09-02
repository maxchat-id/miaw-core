# Deferred Features (Baileys-backed, not yet implemented)

The phased feature roadmap (see [ROADMAP.md](./ROADMAP.md)) is complete through
**v1.12.0**, and so is this backlog.

> **Nothing is currently deferred.** The four sections that used to live here —
> group + community admin, privacy & blocklist, calls, and the leftover message
> types (group-invite cards, pin-in-chat) — all shipped in **v1.12.0**, verified
> against `@whiskeysockets/baileys` 7.0.0-rc14.

If you are looking for work to pick up:

- **[FOLLOW_UPS.md](./FOLLOW_UPS.md)** — known defects and debt, each with the
  reason it was not fixed at the time. That is the live list.
- The section below — capabilities we have looked at and decided **not** to
  wrap. Re-read the reasoning before reviving one; most are blocked upstream or
  belong to the application rather than the library.

When a new Baileys release adds something worth wrapping, add it here rather
than straight to the roadmap, with the method name and the version that
introduced it.

_Last updated: 2026-09-02 (miaw-core v1.12.0)._

---

## Already shipped

Native LID (v1.5.0), rich messages + pairing code (v1.6.0), chat management
(v1.7.0), status + business extras (v1.8.0), communities (v1.9.0), the
`message_receipt` event (v1.9.1), proxy files + rotation (v1.10.0), per-instance
proxy pins + `setProxy()` (v1.11.0), and group/community admin, privacy &
blocklist, calls, group-invite cards and pin-in-chat (v1.12.0).

---

## Intentionally skipped

- **Interactive buttons / lists / templates** — deprecated by WhatsApp.
- **`signalRepository.migrateSession`** — Baileys calls it internally already.
- **Deactivate community** — no Baileys method (`leaveCommunity` is the closest).
- **SOCKS media *download* proxying** — blocked upstream, not deferred: downloads use
  native `fetch(url, { dispatcher })`, which requires an undici Dispatcher, and undici
  ships no SOCKS transport. Uploads and the WebSocket are proxied on SOCKS. Use an
  HTTP/HTTPS proxy if downloads must be proxied. See [PROXY.md](./PROXY.md).
- **Automatic proxy health-checking / failover** — still deferred: it would
  need a connection-state feedback loop into the rotator, and the policy
  (how many failures, how long a drain) belongs to the application. The
  *mechanism* now ships in v1.11.0 — `setProxy()` plus client reuse across
  `disconnect()`/`connect()` — so the recipe in
  [PROXY.md](./PROXY.md#handling-a-dead-proxy) is complete and runnable.
  `miaw-cli proxy test-all` covers the pre-flight case; `weight: 0` is the
  designed drain mechanism.
- **External session stores (Redis/Mongo), message queuing, webhooks** — infra
  ideas with no specific Baileys dependency; add on demand.
