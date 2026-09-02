# Deploying v1.12.x (Baileys rc14)

**Audience:** whoever operates miaw-core deployments.

**Scope:** only what v1.12.0 changes operationally. General deployment, proxy
setup and per-instance proxy pins are unchanged and covered by
[DEPLOYMENT_PROXY.md](./DEPLOYMENT_PROXY.md) and
[DEPLOYMENT_INSTANCE_PROXY.md](./DEPLOYMENT_INSTANCE_PROXY.md).

---

## TL;DR

| Question | Answer |
|---|---|
| New environment variables? | **No.** Still the same five `MIAW_*` vars. |
| Database migration? | **No.** miaw-core has no database. |
| New or changed state on disk? | **No.** Session and `instances.json` formats are untouched. |
| Breaking API changes? | **No.** v1.12.0 is purely additive. |
| Anything that needs a coordinated rollout? | **No.** Deploy it like any other release. |
| So what *does* change? | The Baileys dependency — `7.0.0-rc13` → `7.0.0-rc14`. That is the whole operational story. |

Because sessions are untouched, **rollback does not require re-pairing**. That is
the single most important fact on this page.

---

## 1. The only real change: Baileys rc13 → rc14

miaw-core wraps Baileys, which speaks the WhatsApp Web protocol. Bumping it is
the one part of this release that can affect a running deployment, so it is
worth knowing exactly what moved:

| Upstream change | Operational meaning |
|---|---|
| Bundled WhatsApp Web version constant moved forward | miaw-core already prefers the **live** version from `fetchLatestWaWebVersion()`; the bundled constant is only the third-tier fallback. This makes that fallback healthier, and slightly reduces the chance of a stale-version `428` if WhatsApp's version endpoint is unreachable. |
| Profile-picture `tctoken` is now nested correctly | Fixes `getProfilePicture()` for contacts who have profile-picture privacy enabled. If you saw empty picture URLs for such contacts, expect that to improve. |
| New Android browser identity | **Opt-in only.** Nothing changes unless you set it — see §4. |
| Internal `Long` type import | No effect. |

There are **no** upstream API removals or renames. All 17 symbols miaw-core
imports from Baileys still exist, and `tests/unit/baileys-export-surface.test.ts`
asserts that against the real, unmocked module on every unit run — so a future
upstream rename fails the build rather than surfacing at runtime.

---

## 2. Installing: the version is pinned exactly, on purpose

```json
"@whiskeysockets/baileys": "7.0.0-rc14"
```

No caret. Prerelease caret ranges resolve unpredictably, and this is a protocol
library where an unplanned minor can change pairing behaviour. **Do not relax
this pin** when resolving a lockfile conflict.

After deploying, confirm what actually landed:

```bash
npm ls @whiskeysockets/baileys
# expect: @whiskeysockets/baileys@7.0.0-rc14
```

> **Lockfile note.** `pnpm-lock.yaml` is the lockfile tracked in git, but the
> installed tree in this repo is produced by **npm** (`package-lock.json` is
> gitignored). If your pipeline installs with pnpm, the tracked lockfile is
> authoritative; if it installs with npm, the exact pin in `package.json` is
> what guarantees the version. Either way, verify with the command above rather
> than assuming.

---

## 3. Not on the npm registry

At time of writing, the newest miaw-core on npm is **1.10.0**. Everything since
— 1.11.0, 1.12.0 and 1.12.1 — exists only in git and is **not published**, and
the repository carries no version tags.

This matters if you deploy from the registry: `npm install miaw-core` will give
you 1.10.0 and none of this. Deploy from git (or publish first). Consumers
inside the monorepo depend on it by range —
`miaw-api` requires `miaw-core: ^1.10.0`, which accepts 1.12.0 — so whichever
source they resolve from decides what they actually get.

---

## 4. Do not enable the Android identity in production by accident

v1.12.0 adds `BrowserPresets`, including an Android identity:

```typescript
new MiawClient({ browser: BrowserPresets.android("13") })
```

**The default is unchanged** (`macOS`/`Chrome`), and existing deployments are
unaffected. Before anyone turns it on:

- Baileys marks it **experimental** and logs a warning on connect.
- It changes the device label your users see under **Linked Devices**.
- History-sync depth may differ.
- The reason to use it — receiving view-once media — is **upstream's claim**.
  miaw-core has verified the handshake, not the receipt. See
  [USAGE.md](./USAGE.md#receiving-view-once-messages-android-identity).

Treat it as a per-instance experiment on a spare session, not a fleet default.

---

## 5. After deploying, watch these

The rc14 changes touch connection setup and one IQ query, so a short watch is
worthwhile:

1. **Pairing and reconnect.** Existing sessions should reconnect without a QR.
   A burst of `restartRequired` (515) right after a *fresh* pairing is normal
   and self-healing — it is WhatsApp's post-pair restart, not a failure.
   Persistent `loggedOut` (401) is not normal and means re-pairing.
2. **`428` on connect.** Would indicate version negotiation trouble. Check that
   the deployment can reach WhatsApp's version endpoint; the bundled fallback
   is only used when it cannot.
3. **`getProfilePicture()` calls.** The tctoken fix changes the shape of this
   query. Errors here would be the most likely rc14-specific regression.

---

## 6. Rollback

Purely additive release, unchanged session format:

```bash
# 1. revert the dependency pin
npm pkg set dependencies.@whiskeysockets/baileys=7.0.0-rc13
npm install

# 2. or revert the whole release
git revert --no-commit <merge-commit>
```

**Sessions survive the rollback.** No auth-state, `instances.json` or message
store format changed in either direction, so downgrading does not force
re-pairing. Any code calling the ~37 methods added in v1.12.0 will break on
rollback — that is the only thing to check before reverting.

---

## 7. What was *not* verified before release

Stated plainly so it is not discovered later:

- The full CLI integration suite **has now been run against a live session**
  (2026-09-02): 13/13 suites, 276 passed, 2 skipped, **0 failed**. The fifteen
  failures previously catalogued in [FOLLOW_UPS.md](./FOLLOW_UPS.md) §9 were
  all fixed in v1.12.1.
- View-once **receipt** under the Android identity is unverified — see §4.
- Live verification needs a QR pairing. `npm run test:cli` reports all-green
  when disconnected because connection-dependent tests return early; trust the
  `=== CLI TEST CLIENT CONNECTED ===` banner, not the pass count.

---

_Last updated: 2026-09-02 (miaw-core v1.12.1, Baileys 7.0.0-rc14)._
