# Deferred Features (Baileys-backed, not yet implemented)

The phased feature roadmap (see [ROADMAP.md](./ROADMAP.md)) is complete through
**v1.10.0**. The items below are the remaining Baileys capabilities we deliberately
**deferred** — each is a thin wrapper over a verified `@whiskeysockets/baileys`
7.0.0-rc13 method. This is the backlog to come back to. Ordered by suggested priority.

_Last updated: 2026-07-29 (miaw-core v1.10.0)._

---

## 1. Group + Community admin  ·  suggested: v1.11.0

Settings and join-requests for **both groups and communities** (they share the
same shapes — do them together, one type set + a shared helper). Group settings
(§4 of the old backlog) were never shipped; community admin was deferred in v1.9.0.

- **Settings**
  - Announce-only / restrict info → `groupSettingUpdate` / `communitySettingUpdate` (`'announcement' | 'not_announcement' | 'locked' | 'unlocked'`)
  - Member-add mode → `groupMemberAddMode` / `communityMemberAddMode` (`'admin_add' | 'all_member_add'`)
  - Join-approval mode → `groupJoinApprovalMode` / `communityJoinApprovalMode` (`'on' | 'off'`)
  - Disappearing/ephemeral → `groupToggleEphemeral` / `communityToggleEphemeral(jid, seconds)`; 1:1 via `sendMessage(jid, { disappearingMessagesInChat })`
- **Join requests**
  - List → `groupRequestParticipantsList` / `communityRequestParticipantsList`
  - Approve/reject → `groupRequestParticipantsUpdate` / `communityRequestParticipantsUpdate(jid, participants, 'approve' | 'reject')`

Proposed miaw surface: `setGroupAnnounceOnly`/`setGroupRestrictInfo`/`setGroupMemberAddMode`/`setGroupJoinApproval`/`setGroupEphemeral`, `getGroupJoinRequests`/`approveGroupJoinRequest`/`rejectGroupJoinRequest`, and the `setCommunity*` / `getCommunityJoinRequests` equivalents.

## 2. Privacy & blocklist  ·  suggested: v1.12.0

- Blocklist: `blockContact` / `unblockContact` (`updateBlockStatus(jid, 'block'|'unblock')`), `getBlocklist` (`fetchBlocklist`)
- Privacy: `getPrivacySettings` (`fetchPrivacySettings`) + setters: `updateLastSeenPrivacy`, `updateOnlinePrivacy`, `updateProfilePicturePrivacy`, `updateStatusPrivacy`, `updateReadReceiptsPrivacy`, `updateGroupsAddPrivacy`, `updateMessagesPrivacy`, `updateCallPrivacy`, `updateDefaultDisappearingMode`, `updateDisableLinkPreviewsPrivacy`

## 3. Calls  ·  small

- `rejectCall(callId, callFrom)` — auto-reject incoming calls
- Surface a `call` event from Baileys' `call` event
- `createCallLink(type, event?)` — audio/video call links

## 4. Leftover message types  ·  small

- `sendGroupInvite(to, ...)` → `sendMessage(jid, { groupInvite })`
- `pinMessage()` / `unpinMessage()` → `sendMessage(jid, { pin: key, type, time })` (pin-in-chat, 24h/7d/30d)

---

## Already shipped (not deferred)

Native LID (v1.5.0), rich messages + pairing code (v1.6.0), chat management
(v1.7.0), status + business extras (v1.8.0), communities (v1.9.0), the
**message-receipt event** (v1.9.1), and **proxy files + rotation** (v1.10.0).
~78% Baileys coverage.

## Intentionally skipped

- **Interactive buttons / lists / templates** — deprecated by WhatsApp.
- **`signalRepository.migrateSession`** — Baileys calls it internally already.
- **Deactivate community** — no Baileys method (`leaveCommunity` is the closest).
- **SOCKS media proxying** — blocked upstream, not deferred: Node's `fetch()`
  requires an undici Dispatcher and undici ships no SOCKS transport. Use an
  HTTP/HTTPS proxy, or supply your own `fetchAgent`. See [PROXY.md](./PROXY.md).
- **Runtime proxy health-checking / automatic failover** — would need a
  connection-state feedback loop into the rotator. `miaw-cli proxy test-all`
  covers the pre-flight case; `weight: 0` is the designed drain mechanism.
- **External session stores (Redis/Mongo), message queuing, webhooks** — infra
  ideas with no specific Baileys dependency; add on demand.
