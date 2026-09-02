# Follow-ups

Deliberately deferred items found while building per-instance proxy support
(v1.11.0). Each is a real finding with a reason it was **not** fixed in that
branch. Ordered by severity.

For the standing backlog of Baileys features we chose not to wrap, see
[DEFERRED_FEATURES.md](./DEFERRED_FEATURES.md). This file is for defects and
debt, not features.

---

## 1. `instance status` cannot show status for all instances

**Severity:** low.

`cmdInstanceStatus` (`src/cli/commands/instance.ts`) has a documented "show all
instances" path (`targetInstances = instances` when `instanceId` is empty), but
both call sites pass `subArgs[0] || clientConfig.instanceId`, which is never
empty. The multi-instance branch, and the `id !== config.instanceId` proxy
branch below it, are unreachable.

Pre-existing (the `||` default predates v1.11.0). Fix is either to drop the dead
branches or to add an explicit `instance status --all`. The latter is more
useful, since `instance ls` shows pins but not live connection state per
instance.

---

## 2. `instance ls` shows pins, not the *effective* proxy

**Severity:** low.

The Proxy column uses `describePinnedProxy()`, which is deliberately synchronous
and pin-only so listing N instances costs no file I/O. An instance that will
connect through `--proxy-file` or `--proxy` therefore shows `-`, which reads as
"no proxy" when it is really "not pinned".

Fix would mean resolving each row (async, reads the proxy file, and can emit
override warnings per row). Worth doing behind `instance ls --resolve`, not by
default.

---

## 3. `InstanceInfo.proxy` is write-only

**Severity:** nit.

`src/cli/utils/instance-registry.ts` stores a masked proxy on each registered
instance, and nothing reads it. It was added so the registry could render the
proxy, but `instance ls` reads pins from disk instead (it must also list
instances that were never registered). Either wire it into a display path or
remove it.

---

## 4. Hand-edited `{url, label}` pins disagree between display and resolution

**Severity:** nit.

`setInstanceProxyPin()` rejects a pin carrying both `url` and `label`, so this
only occurs if someone edits `instances.json` by hand. In that case
`describePin()` reports the label (it checks `label` first) while
`resolveProxyForInstance()` uses the url (it checks `url` first) — so `ls` and
`status` would name a proxy the connection does not use.

Fix: make `readInstanceConfig()` reject a pin with both fields, matching the
"refuse rather than guess" stance it already takes for malformed JSON.

---

## 5. `instances.json` ignores the on-disk `version` field

**Severity:** nit.

`readInstanceConfig()` returns `version: 1` regardless of what the file says. A
future v2 file would be silently reinterpreted as v1 rather than refused — the
opposite of the malformed-JSON branch two lines above it. Refuse an unknown
version once a v2 exists.

---

## 6. Test-coverage gaps from the v1.11.0 plan

**Severity:** low.

Two assertions the plan called for were not written:

- `getProxyInfo().pending` has no **positive** test. Only the "not set when no
  socket is open" case is covered, so the one genuinely new field is untested in
  the state it exists for (staged proxy while a socket built from the previous
  one is still open).
- The plan asked to capture `makeWASocket` options and assert the **agent**
  targets the new host after `setProxy()`. The current test asserts
  `getProxyInfo().url` instead, which proves the config changed but not that the
  agent did.

---

## 7. No live-WhatsApp verification was possible for v1.11.0

**Severity:** informational.

The session in `sessions-cli/default` returns `401 loggedOut` — the device was
unlinked, so `AuthHandler.clearSession()` wipes it on connect. Every
connection-dependent CLI integration test therefore short-circuits via
`if (!isConnected()) return;` and reports as passing without exercising
anything.

What *was* verified against real infrastructure: a real HTTP CONNECT proxy
(including auth and a 407 rejection), and a real `MiawClient` connection whose
WebSocket handshake was observed traversing the pinned proxy
(`CONNECT web.whatsapp.com:443` in the proxy log) before WhatsApp rejected the
dead credentials.

To close this, re-pair a device (`miaw-cli instance create <id>`, scan the QR)
and re-run `npm run test:cli`. Worth doing before releasing 1.11.0.

---

## 8. `--json` is not supported by most `instance`/`group`/`chat` commands

**Severity:** low.

v1.11.0 added `--json` to `instance ls`, `set-proxy` and `unset-proxy` to match
`proxy list` and the `get`/`contact`/`catalog` families. `instance status`,
`instance create/delete/connect/disconnect/logout`, and the `chat`/`group`
mutation commands still print prose only, so scripting them means parsing
output. Worth a sweep for consistency rather than one-off additions.
