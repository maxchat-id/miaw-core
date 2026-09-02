# Miaw Core Examples

This directory contains comprehensive examples demonstrating all features of Miaw Core by version.

## Example Files

### 01-basic-bot.ts (v0.1.0)
The simplest example - a basic echo bot that demonstrates:
- Creating a client with session persistence
- QR code authentication
- Sending and receiving text messages
- Basic event handling (ready, disconnected, reconnecting, error)

**Run:** `npx tsx examples/01-basic-bot.ts`

---

### 02-media-bot.ts (v0.2.0)
Demonstrates media handling:
- Sending images with captions (URL, local file)
- Sending videos with GIF support
- Sending audio and voice notes (PTT)
- Sending documents
- Downloading media from received messages

**Run:** `npx tsx examples/02-media-bot.ts`

---

### 03-message-context.ts (v0.3.0)
Advanced message context features:
- Replying to messages (quoting)
- Handling message edits
- Handling message deletions
- Handling reactions (send and receive)

**Run:** `npx tsx examples/03-message-context.ts`

---

### 04-validation-social.ts (v0.4.0)
Contact validation and information:
- Checking if phone numbers are on WhatsApp
- Batch checking multiple numbers
- Getting contact information and status
- Getting business profile details
- Getting profile pictures
- Getting group information and participants

**Run:** `npx tsx examples/04-validation-social.ts`

---

### 05-ux-polish.ts (v0.5.0)
User experience enhancements:
- Read receipts (marking messages as read)
- Typing indicators
- Recording indicators
- Presence management (online/offline status)
- Subscribing to presence updates

**Run:** `npx tsx examples/05-ux-polish.ts`

---

### 06-advanced-messaging.ts (v0.6.0)
Advanced messaging features:
- Sending reactions to messages
- Removing reactions
- Forwarding messages to other chats
- Editing your own messages (within 15-minute window)
- Deleting messages (for everyone)
- Deleting messages locally (for yourself only)

**Run:** `npx tsx examples/06-advanced-messaging.ts`

---

### 07-group-management.ts (v0.7.0)
Complete group administration:
- Creating new groups
- Adding and removing participants (requires admin)
- Promoting and demoting admins (requires admin)
- Updating group name and description (requires admin)
- Managing group profile picture (requires admin)
- Creating and revoking invite links (requires admin)
- Accepting group invites
- Getting group invite info (preview before joining)
- Leaving groups

**Run:** `npx tsx examples/07-group-management.ts`

---

### 08-profile-management.ts (v0.8.0)
Profile management features:
- Updating profile picture (from file, URL, or Buffer)
- Removing profile picture
- Updating display name (push name)
- Updating profile status (About text)

**Run:** `npx tsx examples/08-profile-management.ts`

---

### 09-business-social.ts (v0.9.0)
Business and social features:

**Labels (WhatsApp Business only):**
- Creating custom labels with colors
- Adding labels to chats
- Adding labels to messages
- Removing labels

**Catalog (WhatsApp Business only):**
- Fetching product catalog with pagination
- Fetching catalog collections
- Creating products
- Updating products
- Deleting products

**Newsletters/Channels:**
- Creating newsletters/channels
- Following/unfollowing newsletters
- Muting/unmuting newsletters
- Updating newsletter metadata
- Fetching newsletter messages
- Reacting to newsletter posts
- Managing newsletter subscribers and admins

**Contact Management:**
- Adding or editing contacts
- Removing contacts

**Run:** `npx tsx examples/09-business-social.ts`

### 10-proxy-rotation.ts (v1.10.0, failover updated in v1.11.0)
Connecting through proxies, and giving each instance its own egress IP:

**Single proxy:**
- Configuring one proxy from `MIAW_PROXY`
- Inspecting it with `getProxyInfo()` (credentials masked)

**Multi-instance rotation:**
- Loading a proxy list file with `ProxyRotator.fromFile()`
- Assigning each `instanceId` a **stable** proxy via the deterministic strategy
- Hot-reloading the proxy file
- Why rotation distributes instances across proxies and must never rotate a *live* session's IP

**Failover:**
- Detecting a dead proxy from the `disconnected` event, ignoring `"intentional"`
  (your own `disconnect()`) and requiring several consecutive failures — one
  blip is not a dead proxy
- Dropping it from the pool and re-selecting, without disturbing your other bots
- Applying the replacement to the **same** client with `disconnect()` →
  `setProxy()` → `connect()`. Reusing the client keeps the session, the stores
  and your event handlers; building a second one on the same `instanceId` would
  put two writers on one auth state

**Setup:** `cp examples/proxies.example.txt ./proxies.txt`, then edit it. Validate with
`npx miaw-cli proxy test-all --proxy-file ./proxies.txt` before running.

> ⚠️ SOCKS proxies do not carry media transfers — those fall back to a direct
> connection and reveal your real IP. See [PROXY.md](../docs/PROXY.md).

**Run:** `npx tsx examples/10-proxy-rotation.ts [multi|single|failover]`

### 11-privacy-blocklist.ts (v1.12.0)
Reading and writing account-wide privacy, and the blocklist:

- Reading all eight typed privacy fields
- **Reading the categories miaw-core has no typed field for.** WhatsApp returns
  ~16 categories; Baileys has setters for 8. `getPrivacySettings()` keeps the
  whole response under `raw` rather than dropping half of it
- Round-tripping every setter by writing the current value back, so running the
  example changes nothing
- Why `setDefaultDisappearingMode()` and `setLinkPreviewsDisabled()` are left
  commented out: WhatsApp does not report them back, so there is no value to
  restore
- `getBlocklist()`, `isBlocked()`, and why `blockContact()` is commented out

**Run:** `npx tsx examples/11-privacy-blocklist.ts`

### 12-calls-and-admin.ts (v1.12.0)
Calls, group administration, and choosing your connection identity:

- The `call` event across its whole lifecycle, and why `rejectCall()` only
  works while `status === "offer"`
- `createCallLink()` (commented out — it mints a real, shareable link)
- Announce-only and disappearing-message timers, read-then-restore
- The join-request queue, and the catch that requests only accumulate while
  join approval is ON — an empty list usually means approval is off
- Reading `status` off each participant result instead of a bare boolean
- **`BrowserPresets`** — all four identities, and the tradeoff behind the
  Android one (Baileys reports it is needed to receive view-once media, flags
  it experimental, and it changes your Linked Devices label)

**Run:** `EXAMPLE_GROUP_JID=...@g.us npx tsx examples/12-calls-and-admin.ts`

---

## Other Examples

Not numbered, but worth knowing about:

| File | What it is |
|------|------------|
| `simple-bot.ts` | The smallest possible working bot |
| `realworld/broadcast-bot.ts` | Sending to many recipients with pacing |
| `realworld/customer-service-bot.ts` | Routing, canned replies, business hours |
| `realworld/group-admin-bot.ts` | A moderation bot for a real group |
| `proxies.example.txt` | Template proxy list for `10-proxy-rotation.ts` |

---

## Running Examples

1. Install dependencies:
```bash
npm install
```

`tsx` comes in as a devDependency — there is nothing to install globally, and
`ts-node` will **not** run these files (they are ESM, and it is not a
dependency of this repo).

2. Run any example:
```bash
npx tsx examples/01-basic-bot.ts
```

3. Scan the QR code with your WhatsApp mobile app

4. Start chatting!

## Common Commands

All examples support `!help` to see available commands.

## Tips

- Each bot uses its own session ID, so they won't conflict
- Sessions are saved in `./sessions/` directory
- Delete session directory to re-authenticate
- Many commands work in both private chats and groups
- Some features (labels, catalog) require WhatsApp Business account
- Group admin commands require you to be a group admin

## Need More Help?

See the main documentation:
- [USAGE.md](../docs/USAGE.md) - Complete usage guide
- [PROXY.md](../docs/PROXY.md) - Proxy configuration, rotation, and troubleshooting
- [ROADMAP.md](../docs/ROADMAP.md) - Feature roadmap
- [CHANGELOG.md](../CHANGELOG.md) - Version history
