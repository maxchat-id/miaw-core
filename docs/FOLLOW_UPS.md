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

## 7. No live-WhatsApp verification was possible for v1.11.0 — RESOLVED

**Severity:** informational. **Closed 2026-09-02 (v1.12.0).**

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

**Update (2026-09-02, v1.12.0):** still open, and now confirmed for *every*
session on disk, not just `sessions-cli/default`. A direct connection probe
against `test-sessions/paired-via-proxy` (the freshest, last written
2026-07-29) also returned `401 loggedOut`, and `test-sessions/miaw-test-bot`
had already been wiped by `AuthHandler.clearSession()`. So the v1.12.0 upgrade
to Baileys rc14 and the whole feature backlog it shipped are verified by
`tsc`, 548 unit tests and 66 offline CLI router tests, but **not** against live
WhatsApp.

The rc14 changes that specifically want a live run:

- `profilePictureUrl` against a contact **with profile-picture privacy enabled**
  — that is the only path the upstream tctoken-nesting fix touches. A contact
  without privacy set will pass either way and proves nothing.
- Pairing with `BrowserPresets.android()` on a spare `instanceId`, then sending
  it a view-once image: `message.media.viewOnce` should be `true` and
  `downloadMedia()` should return bytes. This cannot be checked any other way —
  a web-identity session is never sent view-once media at all.
- The v1.12.0 methods that mutate real state: the group/community settings, the
  join-request flow (needs a group with approval turned on), and the blocklist.
  `npm run test:manual privacy` / `calls` / `group` cover these with
  read-then-restore entries.

Also worth noting while re-pairing: `TEST_GROUP_JID` in `.env.test` is empty, so
every group-dependent test skips even on a healthy connection.

**Closed (2026-09-02).** A device was re-paired as `miaw-test-bot` and
`TEST_GROUP_JID` set to a single-member group the bot owns (so settings changes
affect nobody). The full CLI suite then ran genuinely live for the first time:
**221 passed, 15 failed, 2 skipped across 13 files.** Those 15 failures are all
pre-existing and are catalogued in §9 below — proven so by re-running the same
six suites against Baileys rc13, which produced a byte-identical failure set.

Verified live for rc14 specifically:

- **`profilePictureUrl`** — the upstream tctoken-nesting fix. Probed real group
  participants; 2 of 5 resolved to live `pps.whatsapp.net` URLs, the rest
  correctly returning `null` for no-picture/privacy. The fix works.
- **Version negotiation** — handshake completed with no 428.
- **`getPrivacySettings()`** — the category-key mapping is correct against real
  data. WhatsApp returned **16** categories; we map the 8 Baileys has setters
  for, and the other 8 (`channelview`, `cover_photo`, `stickers`,
  `groupcreation`, `linked_profiles`, `channelcreation`,
  `dependentaccountmessages`, `defense`) survive under `raw`. Had we dropped
  unrecognized keys, half the response would have been lost silently.
- **`getBlocklist()`**, **`getGroupJoinRequests()`** — both return correctly.

Still **not** verified live: the Android browser identity and view-once receipt.
That needs a second physical device to pair a spare `instanceId` against, since
switching the primary session's identity means re-pairing it.

---

## 8. `--json` is not supported by most `instance`/`group`/`chat` commands

**Severity:** low.

v1.11.0 added `--json` to `instance ls`, `set-proxy` and `unset-proxy` to match
`proxy list` and the `get`/`contact`/`catalog` families. `instance status`,
`instance create/delete/connect/disconnect/logout`, and the `chat`/`group`
mutation commands still print prose only, so scripting them means parsing
output. Worth a sweep for consistency rather than one-off additions.


---

## 9. Fifteen pre-existing CLI integration failures, surfaced by the first live run

**Severity:** medium (they are real defects; none is new).

Until 2026-09-02 no session on disk authenticated, so every connection-dependent
CLI test short-circuited via `if (!isConnected()) return;` and reported as
passing. The first genuine live run exposed 15 failures. **All predate v1.12.0**
— re-running the same six suites against Baileys rc13 produced an identical
failure set, so none is an rc14 regression.

Four independent causes:

### 9a. `--json` output is polluted by progress text (5 tests)

`check`, `contact info`, `group info`, `group participants` and `label list` all
print human progress lines (`🔍 Checking...`, `📤 Sending...`) **before** the
JSON payload, so `JSON.parse(entireOutput)` throws:

```
SyntaxError: Unexpected token '🔍', "🔍 Checkin"... is not valid JSON
```

This makes `--json` unusable for scripting on those commands, which is the whole
point of the flag. The fix is to suppress progress output when `jsonOutput` is
set — the handlers already receive it. Worth a sweep across every command that
takes `--json`, not just the five with tests.

Affected: `03-check-command`, `04-contact-commands`, `05-group-commands` (×2),
`10-business-commands`.

### 9b. `catalog` tests burn 6 minutes timing out on a personal account (6 tests)

`10-business-commands.test.ts` takes **375 seconds**, almost all of it six
`catalog` tests hitting the 60s Jest timeout. The account under test is not a
Business account, and the test names already say "may fail on non-biz" — but
they hang rather than fail fast, because `getCatalog`/`getCollections` never
respond for a personal account instead of returning an error.

Two things worth fixing independently: the client methods should time out on
their own rather than hanging forever, and the tests should detect account type
(as `interactive-test.ts` already does via `detectAccountType`) and skip.

### 9c. `load messages` times out waiting for history (3 tests)

```
❌ Failed to load messages: Timeout waiting for history (30000ms)
```

`fetchMessageHistory` gets no response for the configured contact, which is the
bot's own number (a send-to-self chat with no older history to page back
through). Plausibly correct WhatsApp behaviour rather than a bug — but the test
asserts `true` unconditionally, so it cannot distinguish "no history" from
"broken". Either point the test at a chat with real history, or accept the
no-history case explicitly.

### 9d. `profile status set` with an empty status is rejected (1 test)

The router deliberately allows an empty status (`// Status can be empty to clear
it`), but `updateProfileStatus("")` returns failure — WhatsApp appears not to
accept an empty about-text this way. Either the comment and dispatch are wrong,
or clearing needs a different call. The test asserts success.
