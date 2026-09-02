# Miaw Core

**Multiple Instance of Awesome WhatsApp** - A simplified WhatsApp API wrapper for Baileys

Miaw Core abstracts away the complexity of Baileys, providing a clean, simple API for building WhatsApp bots and automation tools. It handles all the painful parts: session management, QR codes, reconnection logic, and message parsing.

> **Now powered by Baileys v7.0.0** - Full support for the latest WhatsApp Web features including newsletters/channels

## Why Miaw Core vs Baileys Directly?

| Aspect                 | Baileys (Direct)              | Miaw Core                          |
| ---------------------- | ----------------------------- | ---------------------------------- |
| **Learning Curve**     | Steep - 150+ methods to learn | Gentle - ~200 focused methods      |
| **Setup Code**         | 50-100 lines boilerplate      | 10 lines to start                  |
| **Session Management** | Manual auth state handling    | Automatic file-based persistence   |
| **Reconnection**       | DIY implementation            | Built-in with configurable retries |
| **Message Format**     | Complex nested structures     | Normalized `MiawMessage` objects   |
| **TypeScript**         | Types available but complex   | Clean, simplified types            |
| **Multi-Instance**     | Manual socket management      | Instance ID-based separation       |

**Choose Baileys directly** if you need low-level control, custom implementations, or access to every WhatsApp feature.

**Choose Miaw Core** if you want to build bots quickly with clean code, automatic session handling, and don't need every obscure feature.

For a detailed comparison, see [Baileys vs Miaw Core Comparison](./docs/BAILEYS_VS_MIAW_COMPARISON.md).

## Documentation

- **[CLI Guide](./docs/CLI.md)** - Command-line interface usage
- **[Usage Guide](./docs/USAGE.md)** - Complete guide for all current features
- **[Proxy Guide](./docs/PROXY.md)** - Proxies, proxy list files, and rotation strategies
- **[Proxy Deployment Notes](./docs/DEPLOYMENT_PROXY.md)** - Operational guidance for deploying with proxies
- **[Per-Instance Proxy Deployment](./docs/DEPLOYMENT_INSTANCE_PROXY.md)** - What v1.11.0 changes for operators
- **[LID Resolution](./docs/LID_RESOLUTION.md)** - Working with privacy-masked (`@lid`) JIDs
- **[Baileys Comparison](./docs/BAILEYS_VS_MIAW_COMPARISON.md)** - Feature comparison with raw Baileys
- **[Migration Guide](./docs/MIGRATION.md)** - Upgrading between versions
- **[Test Coverage](./docs/TEST_COVERAGE_ANALYSIS.md)** - API coverage analysis
- **[Roadmap](./docs/ROADMAP.md)** - Feature roadmap and development plan
- **[Changelog](./CHANGELOG.md)** - Version history and changes
- **[Examples](./examples/)** - Code examples and sample bots

## Features

- **Simple API** - Clean, intuitive interface for sending and receiving messages
- **Auto-Reconnection** - Handles connection drops and reconnects automatically
- **Session Management** - File-based session storage with automatic persistence
- **Multiple Instances** - Run multiple WhatsApp connections in a single process
- **Proxy Support** - HTTP/HTTPS/SOCKS proxies, proxy list files, and per-instance proxies (assigned or pinned)
- **TypeScript Support** - Full type definitions for excellent IDE experience
- **Event-Driven** - Easy-to-use event system for messages and connection states
- **Normalized Messages** - Simplified message format, no more complex Baileys structures
- **Business Features** - Label operations, product catalog, newsletter/channels (WhatsApp Business)
- **Contact Management** - Add, edit, and remove contacts
- **Group Management** - Full admin capabilities for groups
- **Profile Management** - Customize bot profile picture, name, and status

## Requirements

- **Node.js** >= 18.0.0
- **ESM** - This package is ESM-only (uses `"type": "module"`)

## Installation

```bash
npm install miaw-core
```

## Quick Start: CLI Tool

Miaw Core includes a built-in CLI tool for quick WhatsApp operations:

```bash
# Start interactive mode
npx miaw-cli

# Or use via npm script
npm run cli

# One-shot commands
npx miaw-cli get groups
npx miaw-cli send text 6281234567890 "Hello!"
npx miaw-cli check 6281234567890
```

**CLI Features:**

- Interactive REPL shell
- List contacts, groups, chats
- Send messages and media
- Group management
- Check phone numbers
- Session management
- JSON output support

See [CLI Guide](./docs/CLI.md) for complete CLI documentation.

## Quick Start: Programmatic

```typescript
import { MiawClient } from "miaw-core";

// Create client
const client = new MiawClient({
  instanceId: "my-bot",
  sessionPath: "./sessions",
});

// Handle QR code
client.on("qr", (qr) => {
  console.log("Scan this QR code:", qr);
});

// When ready
client.on("ready", () => {
  console.log("Bot is ready!");
});

// Receive messages
client.on("message", async (message) => {
  console.log("Received:", message.text);

  // Reply
  await client.sendText(message.from, "Hello!");
});

// Start
await client.connect();
```

For more examples and detailed usage, see the [Usage Guide](./docs/USAGE.md).

## Testing

### Manual Interactive Testing

Drive the API interactively against a live connection:

```bash
# Show available test groups
npm run test:manual

# Run specific test groups
npm run test:manual all         # All tests
npm run test:manual messaging   # Messaging tests only
npm run test:manual newsletter  # Newsletter tests only
npm run test:manual business    # Business features only
```

**Available test groups:**

| Group        | Description                                     |
| ------------ | ----------------------------------------------- |
| `core`       | Connection, lifecycle                           |
| `get`        | Fetch contacts, groups, chats                   |
| `messaging`  | Send/receive, reactions, edit, pin, invites     |
| `contacts`   | Check numbers, contact info                     |
| `group`      | Create, manage participants, admin settings     |
| `community`  | Communities, linked groups, admin, join requests|
| `profile`    | Update picture, name, status                    |
| `business`   | Labels, catalog (Business only)                 |
| `newsletter` | Channels, subscriptions                         |
| `ux`         | Typing, presence, read receipts                 |
| `privacy`    | Privacy settings, block / unblock               |
| `calls`      | Call event, reject, call links                  |

Run `npm run test:manual` with no argument for this list with a live entry count
per group — it is generated from the runner's own category map, so it cannot go
stale.

**Unattended mode:**

```bash
npm run test:manual:auto              # every group, no prompts, non-zero exit on failure
npm run test:manual group -- --auto   # one group
```

Prompts resolve to their `.env.test` defaults. Entries needing a human are
skipped; add `--destructive` to include the ones that change real state.

**Features:**

- Auto-connects using existing session (skips QR if already authenticated)
- Tracks test results with pass/fail/skip status
- Generates summary report with timestamps
- Pre-loads test configuration from `.env.test`
- Warns when `.env.test` is configured in a way that silently invalidates
  results (e.g. both contact numbers set to the bot's own number)

### Unit & Integration Tests

```bash
# Unit suites only - the fast gate (615 tests, no connection needed)
npm run test:unit

# Everything, including the live-connection suites
npm test

# CLI command tests against a real connection (13 files)
npm run test:cli

# Type-check src/ and tests/ together
npm run typecheck

# Watch mode / coverage
npm run test:watch
npm run test:coverage
```

> Jest runs serially (`maxWorkers: 1`): the live suites share one WhatsApp
> session, so a parallel run would have them fighting over it. For the same
> reason, never run two test commands at once.

## Current Capabilities (v1.12.0)

Built on **Baileys v7.0.0-rc14** - the latest WhatsApp Web protocol implementation.

### Core Features

- ✅ Send and receive text messages
- ✅ Send/receive media (images, videos, audio, documents)
- ✅ QR code authentication
- ✅ Session persistence
- ✅ Auto-reconnection
- ✅ Multiple instances
- ✅ Event-driven architecture
- ✅ TypeScript support
- ✅ Error handling

### Networking

- ✅ HTTP / HTTPS / SOCKS4 / SOCKS5 proxies, per instance
- ✅ Per-instance proxy pins that persist — `miaw-cli instance set-proxy <id> ...`, then no flags needed
- ✅ `client.setProxy()` — stage a proxy for the next connect (never rotates a live session's IP)
- ✅ Proxy list files (TXT / JSON) with validation and hot reload
- ✅ Rotation strategies (round-robin, random, weighted, deterministic-per-instance)
- ✅ `miaw-cli proxy test` connectivity diagnostics — no WhatsApp connection needed
- ⚠️ SOCKS proxies: media *downloads* use a direct connection ([details](./docs/PROXY.md#️-socks-media-downloads-use-a-direct-connection))

### Connection Identity

- ✅ Configurable browser identity via `BrowserPresets` (macOS / Windows / Ubuntu / Android)
- ✅ Android identity — Baileys reports this is required to **receive view-once media** ([details](./docs/USAGE.md#receiving-view-once-messages-android-identity))
- ✅ Live WhatsApp Web version negotiation (avoids stale-version 428 rejections)

### Advanced Messaging

- ✅ Reply/quote messages
- ✅ Edit own messages
- ✅ Delete messages
- ✅ Message reactions
- ✅ Forward messages
- ✅ Location, contact cards, polls and stickers
- ✅ Group invite cards — `sendGroupInvite()`
- ✅ Pin / unpin a message in a chat — `pinMessage()` / `unpinMessage()`
- ✅ Disappearing messages per chat — `setChatEphemeral()`

### Group Management

- ✅ Create groups
- ✅ Add/remove participants
- ✅ Promote/demote admins
- ✅ Group invite links
- ✅ Update group settings
- ✅ Announce-only and info-edit locks
- ✅ Member-add mode (admins only / all members)
- ✅ Join approval, plus listing / approving / rejecting join requests
- ✅ Group-wide disappearing messages

### Communities

- ✅ Create communities, link and unlink groups
- ✅ Community members: add, remove, promote, demote
- ✅ Community invite links
- ✅ The same admin surface as groups — announce, restrict, add-mode,
     join approval, join requests, disappearing messages

### Privacy & Blocklist

- ✅ Read all privacy settings, including categories Baileys has no setter for
     (preserved under `raw`)
- ✅ Eight setters — last seen, online, profile picture, status, read receipts,
     group add, messages, calls
- ✅ Default disappearing mode for new chats, and link-preview control
- ✅ Block / unblock, list the blocklist, check whether a contact is blocked

### Calls

- ✅ `call` event for incoming calls (offer / accept / reject / timeout)
- ✅ Reject an incoming call — `rejectCall()`
- ✅ Create shareable call links — `createCallLink()`

### Chat Management

- ✅ Archive, pin, mute, mark read/unread
- ✅ Clear or delete a chat
- ✅ Star / unstar messages

### Profile Management

- ✅ Update profile picture
- ✅ Remove profile picture
- ✅ Update profile name
- ✅ Update profile status

### Business & Social

- ✅ Label operations (WhatsApp Business)
- ✅ Product catalog management (WhatsApp Business)
- ✅ Newsletter/channel operations (create, send, manage)
- ✅ Contact management (add, edit, remove)

See [ROADMAP.md](./docs/ROADMAP.md) for planned features.

## What Miaw Core Abstracts

Miaw Core handles these Baileys complexities for you:

- ✅ QR code generation and handling
- ✅ Auth state management (save/load)
- ✅ Socket connection setup
- ✅ Reconnection logic
- ✅ Message event parsing
- ✅ Connection state tracking
- ✅ Credentials persistence
- ✅ Multi-file auth state
- ✅ Baileys version management
- ✅ Signal key store setup

## Project Structure

```text
miaw-core/
├── bin/
│   └── miaw-cli.ts      # CLI entry point (one-shot + REPL)
├── src/
│   ├── client/          # Main MiawClient class
│   ├── handlers/        # Auth and message handlers
│   ├── types/           # TypeScript definitions
│   ├── constants/       # Shared constant tables
│   ├── utils/           # Proxy agents, rotation, browser presets
│   ├── cli/             # CLI subsystem (commands + utils)
│   └── index.ts         # Public API exports
├── docs/                # Documentation
├── examples/            # Usage examples
├── tests/               # Unit, integration and CLI integration tests
└── README.md            # This file
```

## Contributing

Contributions are welcome! To contribute:

1. Check [ROADMAP.md](./docs/ROADMAP.md) for planned features
2. Open an issue to discuss your idea
3. Fork the repository
4. Create a feature branch
5. Submit a pull request

Please include:

- Tests for new features
- Updated documentation
- Examples if applicable

## License

MIT

## Credits

Built on top of [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) v7.0.0-rc14

---

**Version:** 1.12.0 | **Baileys:** 7.0.0-rc14 | **Status:** Stable | **Updated:** 2026-09-02
