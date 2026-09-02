# Migration Guide

This guide helps you migrate between versions of Miaw Core.

## Table of Contents

- [v1.11.x to v1.12.0](#v111x-to-v1120)
- [v1.10.x to v1.11.0](#v110x-to-v1110)
- [v1.4.0 to v1.4.1](#v140-to-v141)
- [v1.1.x to v1.2.0](#v11x-to-v120)
- [v1.0.x to v1.1.0](#v10x-to-v110)
- [v0.9.x to v1.0.0](#v09x-to-v100)
- [v0.8.x to v0.9.0](#v08x-to-v090)
- [v0.7.x to v0.8.0](#v07x-to-v080)
- [Breaking Changes Summary](#breaking-changes-summary)

---

## v1.11.x to v1.12.0

**Status:** Released — 2026-09-02
**Breaking Changes:** None ✅

Purely additive: Baileys moves 7.0.0-rc13 → 7.0.0-rc14, and ~37 methods plus a
matching CLI surface are added. Nothing existing changed shape, so upgrading is
a version bump.

If you operate a deployment rather than consume the library, see
[DEPLOYMENT_V1.12.0.md](./DEPLOYMENT_V1.12.0.md).

### Baileys 7.0.0-rc13 → rc14

No public API change. Three things worth knowing:

- The bundled WhatsApp Web version constant moved forward. miaw-core already
  prefers the live `fetchLatestWaWebVersion()` result, so this only improves the
  fallback.
- A fix to how the profile-picture `tctoken` is nested, which affects
  `getProfilePicture()` for contacts with a privacy token.
- A new Android browser identity — see below.

### New: connection identity

```typescript
import { MiawClient, BrowserPresets } from "miaw-core";

const client = new MiawClient({
  instanceId: "bot",
  browser: BrowserPresets.android("13"), // default stays macOS/Chrome
});
```

Baileys reports the Android identity is required to **receive view-once media**,
and flags it experimental. miaw-core has verified the handshake, not the receipt
— see [USAGE.md](./USAGE.md#receiving-view-once-messages-android-identity)
before depending on it. The default is unchanged, so existing sessions are
unaffected.

### New methods, no migration required

| Area | Methods |
| --- | --- |
| Group admin | `setGroupAnnounceOnly`, `setGroupRestrictInfo`, `setGroupMemberAddMode`, `setGroupJoinApproval`, `setGroupEphemeral`, `getGroupJoinRequests`, `approveGroupJoinRequests`, `rejectGroupJoinRequests` |
| Community admin | The same eight, as `setCommunity*` / `*CommunityJoinRequests` |
| Privacy | `getPrivacySettings`, and setters for last seen, online, profile picture, status, read receipts, group add, messages, calls, default disappearing mode, link previews |
| Blocklist | `blockContact`, `unblockContact`, `getBlocklist`, `isBlocked` |
| Calls | `call` event, `rejectCall`, `createCallLink` |
| Messaging | `sendGroupInvite`, `pinMessage`, `unpinMessage`, `setChatEphemeral` |

### Two things to know if you read the results

- `getPrivacySettings()` returns typed fields for the eight categories Baileys
  has setters for, and preserves **everything else** under `raw`. WhatsApp
  currently returns 16 categories, so half the response would be lost if you
  read only the typed fields.
- `setChatEphemeral(jid, 0)` turns disappearing messages off. Baileys does not
  treat `0` as "off" on the `sendMessage` path, so miaw-core maps it to `false`
  for you — but `setDefaultDisappearingMode(0)` passes `0` straight through.

### Tooling changes

- `npm run test:manual:build` was **removed**; it never worked, because
  `tsconfig.json` excludes `tests/` so `dist/tests/` is never emitted. Use
  `npm run test:manual`.
- New scripts: `test:unit`, `typecheck`, `test:viewonce`.

---

## v1.10.x to v1.11.0

**Status:** Released — 2026-09-02
**Breaking Changes:** One, affecting library users of `ProxyRotator` only ⚠️

### Breaking: `ProxyRotator` defaults to `deterministic`

`new ProxyRotator(urls)` previously defaulted to `round-robin`, contradicting
both `PROXY.md` (which is headed "`deterministic` — the default, and why") and
`CLAUDE.md`. Only the CLI actually applied `deterministic`.

The mismatch was silent and dangerous: following the documentation gave you
round-robin, which hands a long-lived session a different egress IP on every
call — the exact pattern WhatsApp reads as account takeover. The code was
changed to match the docs so the default fails safe.

**What breaks:** `rotator.next()` with **no `instanceId`**. Deterministic
selection needs an id, so it now throws a message naming the fix.

```typescript
// Before (worked, round-robin)
const rotator = new ProxyRotator(urls);
rotator.next();

// After — either pass the instance id (recommended)
rotator.next(instanceId);      // or rotator.forInstance(instanceId)

// ...or opt back into round-robin explicitly
const rotator = new ProxyRotator({ proxies: urls, strategy: "round-robin" });
rotator.next();
```

Unaffected: any rotator constructed with an explicit `strategy`, and any
`next(instanceId)` call. The sibling `miaw-api` does both, so it needs no
change. CLI users are unaffected — the CLI already defaulted to
`deterministic`.

### New, no migration required

- **`client.setProxy(proxy)`** stages a proxy for the **next** `connect()`.
  It never touches a live socket, because changing a connected session's egress
  IP is read as account takeover. Applying it is an explicit `disconnect()` /
  `connect()` you write — see the failover recipe in
  [PROXY.md](./PROXY.md#handling-a-dead-proxy).
- **`getProxyInfo()` gained `active` and `pending`.** Purely additive; the
  `{ url, protocol }` fields and the `null`-for-custom-agent contract are
  unchanged, so existing callers keep working.
- **Per-instance CLI pins.** `miaw-cli instance set-proxy <id> ...` persists an
  assignment in `<session-path>/instances.json`. New file, read only by 1.11.0+
  and ignored by older versions.

### If you deploy with proxies

`instances.json` is new persistent, secret-grade state that must live on the
same volume as your sessions. Read
[DEPLOYMENT_INSTANCE_PROXY.md](./DEPLOYMENT_INSTANCE_PROXY.md) before upgrading
— in particular, a cluster-wide `MIAW_PROXY` silently outranks every pin.

### Fixed behaviour you may have been relying on

The CLI previously dropped the proxy on `instance create`/`connect`/
`disconnect`/`logout`, and the client cache ignored the proxy entirely — so a
REPL `connect <id>` cached a proxy-less client that later commands reused, and
traffic went direct. If you worked around this (for example by always passing
`--proxy` explicitly), the workaround is no longer needed, though it still
takes precedence.

---

## v1.4.0 to v1.4.1

**Status:** Released — 2026-06-26
**Breaking Changes:** None ✅

v1.4.1 upgrades the Baileys dependency from `7.0.0-rc.9` to `7.0.0-rc13` (the latest
release). It is a drop-in upgrade — no application code changes are required.

### What changed

- **Baileys `7.0.0-rc.9` → `7.0.0-rc13`** (pinned exactly). Brings security fixes
  (GHSA-qvv5-jq5g-4cgg, a protocolMessage parse-regression fix), performance and
  stability work, and libsignal published to the npm registry.
- **LID → phone resolution updated for the rc10+ field changes.** Baileys rc10
  removed `Contact.jid` (now `Contact.phoneNumber`) and rc13 stopped setting
  `senderPn` / `participantPn` / `senderLid` on message keys (now `remoteJidAlt` /
  `participantAlt` + `addressingMode`). miaw-core reads the modern fields, so
  `senderPhone` keeps resolving for privacy-masked (`@lid`) senders. See
  [LID_RESOLUTION.md](./LID_RESOLUTION.md).

### Do I need to change anything?

No. The public API is unchanged, and persisted `lid-mappings.json` files remain
compatible.

### Known issue

- Newsletter **creation** may return `success` with an empty `newsletterId` on rc13:
  Baileys currently fails to parse the create response (`invalid mex newsletter
  notification content`) even though the newsletter is created server-side. Tracked
  upstream.

---

## v1.1.x to v1.2.0

**Status:** Code Quality Release (TBD)
**Breaking Changes:** None ✅

v1.2.0 is a non-breaking release focused on code quality, type safety, and developer experience improvements. All existing code continues to work without modifications.

### New Features

#### 1. Configurable Timeouts

Customize timeout values for your specific deployment environment:

```typescript
import { MiawClient } from "miaw-core";

const client = new MiawClient({
  instanceId: "my-bot",
  sessionPath: "./sessions",
  // All optional with sensible defaults
  stuckStateTimeout: 30000,      // Default: 30s - stuck connection state timeout
  qrGracePeriod: 30000,           // Default: 30s - grace period for QR scan connection
  qrScanTimeout: 60000,           // Default: 60s - timeout for QR code scanning
  connectionTimeout: 120000,      // Default: 120s - overall connection timeout
});
```

#### 2. Validation Utilities

Prevent errors before sending requests:

```typescript
import {
  validatePhoneNumber,
  validateJID,
  validateMessageText,
  validateGroupName,
  validatePhoneNumbers,
} from "miaw-core";

const phoneCheck = validatePhoneNumber("6281234567890");
if (!phoneCheck.valid) {
  console.error(phoneCheck.error); // Descriptive error message
}
```

**Auto-validation:** `sendText()` and `createGroup()` now automatically validate inputs.

#### 3. Custom Logger Support

Implement your own logger or use the built-in filtered logger:

```typescript
import { MiawClient, createFilteredLogger } from "miaw-core";
import type { MiawLogger } from "miaw-core";

// Option 1: Built-in filtered logger
const logger = createFilteredLogger(true); // debug mode

// Option 2: Custom logger
const customLogger: MiawLogger = {
  info: (...msg) => myLogger.info(...msg),
  error: (...msg) => myLogger.error(...msg),
  warn: (...msg) => myLogger.warn(...msg),
  debug: (...msg) => myLogger.debug(...msg),
  fatal: (...msg) => myLogger.fatal(...msg),
  trace: (...msg) => myLogger.trace(...msg),
  child: (bindings) => customLogger,
  level: "info",
};

const client = new MiawClient({
  instanceId: "my-bot",
  sessionPath: "./sessions",
  logger: customLogger,
});
```

**Important:** miaw-core no longer overrides global `console.log/error/warn`.

#### 4. Type Safety Improvements

- Replaced `any` types with proper TypeScript interfaces
- New Baileys type exports for advanced users:

```typescript
import type {
  BaileysMessage,
  BaileysMessageUpsert,
  BaileysConnectionUpdate,
  Long,
} from "miaw-core";
```

- Type guard utilities:

```typescript
import { isError, getErrorMessage } from "miaw-core";

try {
  // ... code
} catch (error: unknown) {
  console.error(getErrorMessage(error)); // Safe error handling
}
```

#### 5. Exported Constants

Access internal constants for consistency:

```typescript
import { TIMEOUTS, THRESHOLDS, CACHE_CONFIG, getLabelColorName } from "miaw-core";

console.log(TIMEOUTS.CONNECTION_TIMEOUT); // 120000
console.log(getLabelColorName(0));         // "Color 1 (Dark Blue)"
```

### Internal Improvements

- Removed global state pollution (console override, signal handlers)
- Better error handling throughout
- Improved code organization and maintainability
- Fixed circular dependencies in CLI
- Enhanced encapsulation (LRU cache, prompt utility)

### Migration Steps

```bash
npm install miaw-core@^1.2.0
```

**No code changes required.** Optionally leverage new features:

1. **Add validation** to prevent errors:

   ```typescript
   const check = validatePhoneNumber(phone);
   if (!check.valid) return { error: check.error };
   ```

2. **Customize timeouts** for slow networks:

   ```typescript
   const client = new MiawClient({
     // ... other options
     connectionTimeout: 180000, // 3 minutes
   });
   ```

3. **Implement custom logger** for your logging infrastructure

### For Library Consumers

**Before v1.2.0:**

- Global console was overridden
- Signal handlers registered automatically
- Limited type safety

**After v1.2.0:**

- ✅ Global console untouched
- ✅ Signal handlers only in CLI mode
- ✅ Full type safety
- ✅ Optional validation utilities
- ✅ Configurable timeouts

**Action Required:** None - improvements work automatically!

---

## v1.0.x to v1.1.0

**Status:** Stable Release (2026-01-02)

v1.1.0 upgrades to Baileys v7.0.0-rc.9 and migrates to ESM-only. This fixes the session reconnection issue where the app couldn't reconnect after QR scan and restart.

### Breaking Changes

#### ESM-Only Package

Miaw Core is now ESM-only. CommonJS `require()` is no longer supported.

```typescript
// ❌ Before (CommonJS - no longer works)
const { MiawClient } = require("miaw-core");

// ✅ After (ESM)
import { MiawClient } from "miaw-core";
```

#### Node.js Version

Node.js >= 18.0.0 is now required.

### Migration Steps

1. **Update your package.json:**

   ```json
   {
     "type": "module"
   }
   ```

   Or rename your files from `.js` to `.mjs`.

2. **Update imports to ESM syntax:**

   ```typescript
   // Change require() to import
   import { MiawClient } from "miaw-core";
   ```

3. **Update dependencies:**

   ```bash
   npm install miaw-core@latest
   ```

4. **Check Node.js version:**

   ```bash
   node -v  # Must be >= 18.0.0
   ```

5. **Delete old sessions (recommended):**
   ```bash
   rm -rf ./sessions
   ```
   Re-pair with QR code to get fresh session with Baileys v7.

### What's Fixed

- Session persistence after QR scan - apps can now restart and reconnect without re-pairing
- Improved Signal key store transaction safety
- Better pre-key synchronization

---

## v0.9.x to v1.0.0

**Status:** Stable Release (2025-12-24)

v1.0.0 is the first stable release. While we aim for no breaking changes, here are the important changes to note:

### New Features

#### Resource Cleanup

New `dispose()` method for proper cleanup:

```typescript
// Before (v0.9.x)
// No explicit cleanup needed

// After (v1.0.0)
await client.dispose(); // Clean up resources
```

#### LID Cache Management

New methods for managing LID to JID mapping cache:

```typescript
// Get cache size
const size = client.getLidCacheSize();

// Clear cache
client.clearLidCache();

// Get all mappings
const mappings = client.getLidMappings(); // Returns Record<string, string>
```

### Performance Improvements

- LID mappings now use LRU cache with max size of 1000 entries
- Automatic eviction of least recently used mappings
- Improved memory management for long-running bots

### Migration Steps

1. **Update dependencies:**

   ```bash
   npm install miaw-core@latest
   ```

2. **Add cleanup on shutdown (recommended):**

   ```typescript
   process.on("SIGINT", async () => {
     await client.dispose();
     process.exit(0);
   });
   ```

3. **Test your bot thoroughly** - v1.0.0 has stability guarantees

---

## v0.8.x to v0.9.0

### Label Operations (WhatsApp Business)

New methods for managing labels:

```typescript
// Create or edit a label
await client.addLabel({
  name: "VIP Customers",
  color: LabelColor.Color1,
});

// Add label to chat
await client.addChatLabel(chatJid, labelId);

// Add label to message
await client.addMessageLabel(messageId, chatJid, labelId);

// Remove labels
await client.removeChatLabel(chatJid, labelId);
await client.removeMessageLabel(messageId, chatJid, labelId);
```

### Catalog/Product Operations (WhatsApp Business)

```typescript
// Get product catalog
const catalog = await client.getCatalog(businessJid);

// Create product
await client.createProduct({
  name: "Product Name",
  price: 1999, // in cents
  description: "Description",
});

// Update product
await client.updateProduct(productId, { name: "New Name" });

// Delete products
await client.deleteProducts([productId1, productId2]);
```

### Newsletter/Channel Operations

```typescript
// Create newsletter
const result = await client.createNewsletter("My Channel");

// Follow/unfollow
await client.followNewsletter(newsletterId);
await client.unfollowNewsletter(newsletterId);

// Update newsletter
await client.updateNewsletterName(newsletterId, "New Name");
await client.updateNewsletterDescription(newsletterId, "New Description");
await client.updateNewsletterPicture(newsletterId, { url: "..." });

// Get messages
const messages = await client.fetchNewsletterMessages(newsletterId);

// React to posts
await client.reactToNewsletterMessage(newsletterId, messageId, "👍");

// Newsletter management
await client.getNewsletterSubscribers(newsletterId);
await client.changeNewsletterOwner(newsletterId, newOwnerId);
await client.deleteNewsletter(newsletterId);
```

### Contact Management

```typescript
// Add or edit contact
await client.addOrEditContact({
  phone: "6281234567890",
  name: "John Doe",
});

// Remove contact
await client.removeContact("6281234567890");
```

---

## v0.7.x to v0.8.0

### Profile Management

New profile management methods:

```typescript
// Update profile picture (file path, URL, or Buffer)
await client.updateProfilePicture({ path: "./profile.jpg" });
await client.updateProfilePicture({ url: "https://..." });
await client.updateProfilePicture({ buffer: imageBuffer });

// Remove profile picture
await client.removeProfilePicture();

// Update profile name
await client.updateProfileName("My Bot Name");

// Update profile status (About)
await client.updateProfileStatus("Available for chats");
```

---

## Breaking Changes Summary

| Version | Change                                           | Migration Required |
| ------- | ------------------------------------------------ | ------------------ |
| v1.12.0 | None — additive only (rc14 + ~37 methods)        | No                 |
| v1.11.0 | `ProxyRotator` defaults to `deterministic`       | Yes, if calling `next()` with no instanceId |
| v1.0.0  | New `dispose()` method                           | Recommended        |
| v1.0.0  | `getLidMappings()` returns object instead of Map | Yes, if using      |
| v0.9.0  | Label operations added                           | No (new features)  |
| v0.9.0  | Catalog operations added                         | No (new features)  |
| v0.9.0  | Newsletter operations added                      | No (new features)  |
| v0.9.0  | Contact operations added                         | No (new features)  |
| v0.8.0  | Profile management added                         | No (new features)  |
| v0.7.0  | Group management added                           | No (new features)  |

---

## Upgrading Best Practices

1. **Read the changelog** - Always check `CHANGELOG.md` for detailed changes
2. **Test in development** - Test your bot thoroughly before deploying to production
3. **Backup sessions** - Keep a backup of your `sessions/` directory
4. **Update gradually** - Don't skip versions when possible
5. **Check examples** - Look at `examples/` for updated usage patterns

---

## Getting Help

If you encounter issues during migration:

1. Check the [USAGE.md](./USAGE.md) for detailed documentation
2. Review [examples/](../examples/) for sample implementations
3. Open an issue on GitHub with:
   - Your current version
   - Target version
   - Error messages
   - Code snippets

---

## Version Compatibility

| Miaw Core | Node.js  | Baileys    | Status               |
| --------- | -------- | ---------- | -------------------- |
| 1.12.0    | >=18.0.0 | 7.0.0-rc14 | Stable (current)     |
| 1.5.0 – 1.11.0 | >=18.0.0 | 7.0.0-rc13 | Stable          |
| 1.4.1     | >=18.0.0 | 7.0.0-rc13 | Stable               |
| 1.0.0     | >=18.0.0 | 6.7.21+    | Stable (Coming Soon) |
| 0.9.x     | >=18.0.0 | 6.7.21+ | Stable               |
| 0.8.x     | >=18.0.0 | 6.7.21+ | Stable               |
| 0.7.x     | >=18.0.0 | 6.7.21+ | Stable               |
| < 0.7     | >=18.0.0 | 6.7.21+ | Upgraded recommended |

---

**Last Updated:** 2026-09-02
