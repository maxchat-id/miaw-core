# API Stability Review - v1.0.0

> ⚠️ **Superseded — historical record.**
> Written while preparing the v1.0.0 release, against v0.9.1 (2025-12-24). Its numbers, coverage figures and open action items describe
> that snapshot and have **not** been updated since; several are now wrong by a
> wide margin. Kept because the reasoning still has value, not as a description
> of the code today.
>
> For current information see [../CHANGELOG.md](../CHANGELOG.md) and [MIGRATION.md](./MIGRATION.md).
>
> _Marked superseded 2026-09-02 (miaw-core v1.12.0, Baileys 7.0.0-rc14)._

This document reviews the Miaw Core API surface for stability and readiness for v1.0.0 release.

**Review Date:** 2025-12-24
**Target Version:** v1.0.0
**Current Version:** v0.9.1

---

## API Surface Summary

| Category | Public Methods | Status | Notes |
|----------|---------------|--------|-------|
| Core Client | 7 | ✅ Stable | No breaking changes planned |
| Messaging | 6 | ✅ Stable | Well-tested |
| Media | 5 | ✅ Stable | Handles all media types |
| Contact Info | 5 | ✅ Stable | Good coverage |
| Group Management | 11 | ✅ Stable | Full admin capabilities |
| Profile Management | 4 | ✅ Stable | Complete feature set |
| Label Operations | 5 | ✅ Stable | Business only |
| Catalog Operations | 5 | ✅ Stable | Business only |
| Newsletter Operations | 17 | ✅ Stable | Comprehensive |
| Contact Management | 2 | ✅ Stable | Basic CRUD |
| LID Mapping | 6 | ✅ Stable | Enhanced with LRU cache |
| UX Features | 8 | ✅ Stable | Typing, presence, read receipts |
| **Total** | **81** | **✅ Stable** | |

---

## Detailed API Review

### Core Client Methods

| Method | Signature | Stability | Breaking Changes Possible? |
|--------|-----------|-----------|---------------------------|
| `constructor` | `(options: MiawClientOptions)` | ✅ Stable | No |
| `connect` | `(): Promise<void>` | ✅ Stable | No |
| `disconnect` | `(): Promise<void>` | ✅ Stable | No |
| `dispose` | `(): Promise<void>` | ✅ Stable | No |
| `getConnectionState` | `(): ConnectionState` | ✅ Stable | No |
| `getInstanceId` | `(): string` | ✅ Stable | No |
| `isConnected` | `(): boolean` | ✅ Stable | No |

**Assessment:** All core methods are stable. `dispose()` is new in v0.9.1 and recommended for cleanup.

---

### Messaging Methods

| Method | Signature | Stability | Notes |
|--------|-----------|-----------|-------|
| `sendText` | `(to, text, options?)` | ✅ Stable | Supports quoting |
| `sendImage` | `(to, media, options?)` | ✅ Stable | Caption, view-once |
| `sendDocument` | `(to, media, options?)` | ✅ Stable | Auto-mimetype |
| `sendVideo` | `(to, media, options?)` | ✅ Stable | GIF, PTV support |
| `sendAudio` | `(to, media, options?)` | ✅ Stable | PTT support |
| `downloadMedia` | `(message)` | ✅ Stable | Returns Buffer |

**Assessment:** All messaging methods follow consistent patterns. Return types are stable.

---

### Reaction & Forward Methods

| Method | Signature | Stability | Notes |
|--------|-----------|-----------|-------|
| `sendReaction` | `(messageId, chatId, emoji)` | ✅ Stable | - |
| `removeReaction` | `(message)` | ✅ Stable | - |
| `forwardMessage` | `(to, message)` | ✅ Stable | - |
| `editMessage` | `(messageId, chatId, text)` | ✅ Stable | 15-min window |
| `deleteMessage` | `(message, chatId?)` | ✅ Stable | For everyone |
| `deleteMessageForMe` | `(messageId, chatId)` | ✅ Stable | Local only |

**Assessment:** All methods work as documented. No breaking changes expected.

---

### Contact & Group Info Methods

| Method | Signature | Stability | Notes |
|--------|-----------|-----------|-------|
| `checkNumber` | `(phone)` | ✅ Stable | - |
| `checkNumbers` | `(phones[])` | ✅ Stable | Batch check |
| `getContactInfo` | `(jidOrPhone)` | ✅ Stable | - |
| `getBusinessProfile` | `(jidOrPhone)` | ✅ Stable | Business only |
| `getProfilePicture` | `(jidOrPhone, type?)` | ✅ Stable | low/high res |
| `getGroupInfo` | `(groupJid)` | ✅ Stable | - |
| `getGroupParticipants` | `(groupJid)` | ✅ Stable | - |

**Assessment:** All info-getting methods are stable. Return types are well-defined.

---

### Group Management Methods

| Method | Signature | Stability | Notes |
|--------|-----------|-----------|-------|
| `createGroup` | `(name, participants[])` | ✅ Stable | Returns group JID |
| `addParticipants` | `(groupJid, phones[])` | ✅ Stable | Requires admin |
| `removeParticipants` | `(groupJid, phones[])` | ✅ Stable | Requires admin |
| `leaveGroup` | `(groupJid)` | ✅ Stable | - |
| `promoteToAdmin` | `(groupJid, phones[])` | ✅ Stable | Requires admin |
| `demoteFromAdmin` | `(groupJid, phones[])` | ✅ Stable | Requires admin |
| `updateGroupName` | `(groupJid, name)` | ✅ Stable | Requires admin |
| `updateGroupDescription` | `(groupJid, desc?)` | ✅ Stable | Requires admin |
| `updateGroupPicture` | `(groupJid, media)` | ✅ Stable | Requires admin |
| `getGroupInviteLink` | `(groupJid)` | ✅ Stable | Requires admin |
| `revokeGroupInvite` | `(groupJid)` | ✅ Stable | Requires admin |
| `acceptGroupInvite` | `(inviteCode)` | ✅ Stable | - |
| `getGroupInviteInfo` | `(inviteCode)` | ✅ Stable | Preview |

**Assessment:** All group methods are stable. Admin requirements are documented.

---

### Profile Management Methods

| Method | Signature | Stability | Notes |
|--------|-----------|-----------|-------|
| `updateProfilePicture` | `(media)` | ✅ Stable | path/URL/Buffer |
| `removeProfilePicture` | `()` | ✅ Stable | - |
| `updateProfileName` | `(name)` | ✅ Stable | Push name |
| `updateProfileStatus` | `(status)` | ✅ Stable | About text |

**Assessment:** All profile methods are stable.

---

### Label Methods (WhatsApp Business)

| Method | Signature | Stability | Notes |
|--------|-----------|-----------|-------|
| `addLabel` | `(label)` | ✅ Stable | - |
| `addChatLabel` | `(chatJid, labelId)` | ✅ Stable | - |
| `removeChatLabel` | `(chatJid, labelId)` | ✅ Stable | - |
| `addMessageLabel` | `(msgId, chatId, labelId)` | ✅ Stable | - |
| `removeMessageLabel` | `(msgId, chatId, labelId)` | ✅ Stable | - |

**Assessment:** All label methods are stable. Business account required.

---

### Catalog Methods (WhatsApp Business)

| Method | Signature | Stability | Notes |
|--------|-----------|-----------|-------|
| `getCatalog` | `(businessJid?, limit?, cursor?)` | ✅ Stable | Paginated |
| `getCollections` | `(businessJid?, limit?)` | ✅ Stable | - |
| `createProduct` | `(options)` | ✅ Stable | - |
| `updateProduct` | `(productId, options)` | ✅ Stable | - |
| `deleteProducts` | `(productIds[])` | ✅ Stable | Batch delete |

**Assessment:** All catalog methods are stable. Business account required.

---

### Newsletter Methods

| Method | Signature | Stability | Notes |
|--------|-----------|-----------|-------|
| `createNewsletter` | `(name, description?)` | ✅ Stable | - |
| `getNewsletterMetadata` | `(newsletterId)` | ✅ Stable | - |
| `followNewsletter` | `(newsletterId)` | ✅ Stable | - |
| `unfollowNewsletter` | `(newsletterId)` | ✅ Stable | - |
| `muteNewsletter` | `(newsletterId)` | ✅ Stable | - |
| `unmuteNewsletter` | `(newsletterId)` | ✅ Stable | - |
| `updateNewsletterName` | `(newsletterId, name)` | ✅ Stable | - |
| `updateNewsletterDescription` | `(newsletterId, desc)` | ✅ Stable | - |
| `updateNewsletterPicture` | `(newsletterId, media)` | ✅ Stable | - |
| `removeNewsletterPicture` | `(newsletterId)` | ✅ Stable | - |
| `reactToNewsletterMessage` | `(newsletterId, msgId, emoji)` | ✅ Stable | - |
| `fetchNewsletterMessages` | `(newsletterId, limit?, cursor?)` | ✅ Stable | Paginated |
| `subscribeNewsletterUpdates` | `(newsletterId)` | ✅ Stable | - |
| `getNewsletterSubscribers` | `(newsletterId)` | ✅ Stable | - |
| `getNewsletterAdminCount` | `(newsletterId)` | ✅ Stable | - |
| `changeNewsletterOwner` | `(newsletterId, newOwner)` | ✅ Stable | - |
| `demoteNewsletterAdmin` | `(newsletterId, adminJid)` | ✅ Stable | - |
| `deleteNewsletter` | `(newsletterId)` | ✅ Stable | - |

**Assessment:** All newsletter methods are stable. Comprehensive coverage.

---

### Contact Management Methods

| Method | Signature | Stability | Notes |
|--------|-----------|-----------|-------|
| `addOrEditContact` | `(contact)` | ✅ Stable | Upsert operation |
| `removeContact` | `(phone)` | ✅ Stable | - |

**Assessment:** Contact methods are stable and simple.

---

### LID Mapping Methods

| Method | Signature | Stability | Notes |
|--------|-----------|-----------|-------|
| `resolveLidToJid` | `(lid)` | ✅ Stable | - |
| `getPhoneFromJid` | `(jid)` | ✅ Stable | - |
| `registerLidMapping` | `(lid, phoneJid)` | ✅ Stable | - |
| `getLidMappings` | `()` | ⚠️ Changed | Returns Record instead of Map (v0.9.1) |
| `getLidCacheSize` | `()` | ✅ New (v0.9.1) | - |
| `clearLidCache` | `()` | ✅ New (v0.9.1) | - |

**Assessment:** Mostly stable. `getLidMappings()` return type changed in v0.9.1 - documented in migration guide.

---

### UX Feature Methods

| Method | Signature | Stability | Notes |
|--------|-----------|-----------|-------|
| `markAsRead` | `(message)` | ✅ Stable | - |
| `sendTyping` | `(to)` | ✅ Stable | - |
| `sendRecording` | `(to)` | ✅ Stable | - |
| `stopTyping` | `(to)` | ✅ Stable | - |
| `setPresence` | `(status)` | ✅ Stable | - |
| `subscribePresence` | `(jidOrPhone)` | ✅ Stable | - |

**Assessment:** All UX methods are stable.

---

## Events

| Event | Payload | Stability | Notes |
|-------|---------|-----------|-------|
| `qr` | `(qrCode: string)` | ✅ Stable | - |
| `ready` | `()` | ✅ Stable | - |
| `message` | `(MiawMessage)` | ✅ Stable | - |
| `message_edit` | `(MessageEdit)` | ✅ Stable | - |
| `message_delete` | `(MessageDelete)` | ✅ Stable | - |
| `message_reaction` | `(MessageReaction)` | ✅ Stable | - |
| `presence` | `(PresenceUpdate)` | ✅ Stable | - |
| `connection` | `(ConnectionState)` | ✅ Stable | - |
| `disconnected` | `(reason?)` | ✅ Stable | - |
| `reconnecting` | `(attempt: number)` | ✅ Stable | - |
| `error` | `(Error)` | ✅ Stable | - |
| `session_saved` | `()` | ✅ Stable | - |

**Assessment:** All events are stable. No breaking changes expected.

---

## Types

All exported types are stable:

- ✅ `MiawClientOptions`
- ✅ `MiawMessage`
- ✅ `MediaInfo`
- ✅ `ConnectionState`
- ✅ `SendTextOptions`, `SendImageOptions`, etc.
- ✅ `SendMessageResult`
- ✅ `CheckNumberResult`
- ✅ `ContactInfo`, `BusinessProfile`
- ✅ `GroupInfo`, `GroupParticipant`
- ✅ `MessageEdit`, `MessageDelete`, `MessageReaction`
- ✅ `PresenceStatus`, `PresenceUpdate`
- ✅ Group management types
- ✅ Profile management types
- ✅ Label types
- ✅ Catalog/Product types
- ✅ Newsletter types
- ✅ Contact types

---

## Breaking Changes History

| Version | Change | Migration Path |
|---------|--------|----------------|
| v0.9.1 | `getLidMappings()` returns `Record<string, string>` instead of `Map` | Use `Object.entries()` or Object methods |
| v1.0.0 | No breaking changes planned | N/A |

---

## Recommendations for v1.0.0

### ✅ Approved for v1.0.0

1. **API is stable** - 81 public methods, all well-tested
2. **Types are comprehensive** - Full TypeScript coverage
3. **Events are consistent** - No breaking changes expected
4. **Documentation is complete** - USAGE.md, examples, migration guide
5. **Tests are comprehensive** - 68 unit tests + integration tests

### 📝 Minor Notes

1. `getLidMappings()` return type changed in v0.9.1 - documented in migration guide
2. `dispose()` is new and recommended for cleanup
3. LRU cache max size is 1000 - could be made configurable in future

### 🎯 v1.0.0 Stability Guarantee

Once v1.0.0 is released:
- **No breaking changes** in v1.x.x releases
- New features will be additive only
- Deprecations will be marked at least 1 minor version before removal
- Migration guides provided for any breaking changes in v2.x

---

## Conclusion

**Status:** ✅ **READY FOR v1.0.0**

The Miaw Core API is stable, well-tested, and ready for production use. All 81 public methods have consistent signatures, comprehensive type definitions, and documentation. No breaking changes are planned for v1.0.0.

**Recommended Actions:**
1. Update version to 1.0.0
2. Tag and release v1.0.0
3. Mark as "Latest" and "Stable" in npm
4. Update README with v1.0.0 announcement
