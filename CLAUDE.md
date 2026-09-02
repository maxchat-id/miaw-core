# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**miaw-core** is a TypeScript library that simplifies the Baileys WhatsApp Web API. It abstracts away session management, QR code handling, reconnection logic, and message normalization, providing a clean event-driven API for WhatsApp automation with multi-instance support.

**Key abstraction**: miaw-core handles all Baileys boilerplate so developers can focus on bot logic instead of connection lifecycle, auth state management, and message parsing.

**Current Version**: 1.12.1
**Baileys Version**: 7.0.0-rc14
**Module System**: ESM-only (`"type": "module"`)
**Node.js Required**: >= 18.0.0

---

## Development Commands

### Building & Development

```bash
npm run build         # Compile TypeScript to dist/
npm run dev           # Watch mode for development
npm run lint          # Run ESLint
npm run lint:fix      # Auto-fix linting issues
```

### Testing

Jest runs serially (`maxWorkers: 1` in `jest.config.js`): the live-connection
suites share one WhatsApp session, and a full parallel run is memory-hungry.
Do not run two test commands concurrently.

```bash
# Unit and integration tests (Jest)
npm test                    # Run everything, incl. live-connection suites
npm run test:unit           # Unit suites only - the fast gate
npm run typecheck           # tsc --noEmit over src/ AND tests/
npm run test:watch          # Watch mode
npm run test:coverage       # Generate coverage report

# CLI integration tests (13 files, real WhatsApp connection)
npm run test:cli            # Run all CLI tests (skips if not connected)

# Interactive manual testing (live connection, human-driven)
npm run test:manual         # Show available test groups
npm run test:manual all     # Test all features
npm run test:manual messaging   # Test messaging only
npm run test:manual business    # Test business features
npm run test:manual newsletter  # Test newsletter/channels
npm run test:manual privacy     # Test privacy + blocklist
npm run test:manual calls       # Test call event / reject / links
npm run test:manual community   # Test communities + community admin

# Android-identity / view-once verification (needs a second phone)
npm run test:viewonce

# Unattended: no prompts, exits non-zero on failure
npm run test:manual:auto              # all groups
npm run test:manual group -- --auto   # one group
```

The interactive test suite (`npm run test:manual`) drives a curated subset of the
API against a live connection. Run it with no argument to list the groups with a
live count per group — the list is generated from `CATEGORY_MAP`, so it cannot
drift from the code the way the old hand-written list did.

> `docs/TEST_COVERAGE_ANALYSIS.md` is the historical coverage report. Its
> percentages predate v1.5.0 and are badly stale; read its banner before
> quoting any number from it.

**`--auto` (v1.12.0) makes it a real gate.** Every prompt resolves to its default — which the helpers already treat as "use the `.env.test` value" — so the same entries run without a human, and the process exits non-zero if any failed. Two flags on `TestItem` control what runs:

- `manual: true` — needs a human to act out-of-band (send the bot a message, place a call). Always skipped under `--auto`; env config cannot substitute.
- `destructive: true` — irreversibly changes real state (leaves a group, deletes a product), **or** changes a setting WhatsApp will not read back, so the entry cannot restore what you had. Skipped unless `--destructive` / `AUTO_DESTRUCTIVE=1`.

Tag new entries accordingly, or an unattended run will hang on a prompt or wreck the test account.

On connect it also warns about `.env.test` config that silently invalidates results — both contact numbers being equal, or being the connected account's own number. That combination makes `checkNumbers`, `addParticipants`, `promoteToAdmin`, `demoteFromAdmin` and `blockContact` fail for reasons unrelated to the code (WhatsApp deduplicates a batch check, refuses a self-block, and will not add you to a group you are already in).

**CLI integration tests** (`npm run test:cli`) exercise all CLI commands via `runCommand()` with a real WhatsApp connection. Tests skip gracefully when not connected. Uses `--runInBand` (sequential, shared connection) and `--forceExit`. See [CLI Integration Test Plan](./docs/CLI_INTEGRATION_TEST_PLAN.md).

### CLI Tool

```bash
npm run cli                 # Start interactive REPL mode
npx miaw-cli               # One-shot commands
npx miaw-cli get groups    # Example: get groups
npx miaw-cli send text 6281234567890 "Hello"
```

See [CLI.md](./docs/CLI.md) for comprehensive CLI documentation.

---

## Architecture

### Core Components

miaw-core uses a layered architecture with three main components:

#### 1. MiawClient ([src/client/MiawClient.ts](src/client/MiawClient.ts))

The main entry point that extends EventEmitter for event-driven architecture.

**Responsibilities:**
- Manages Baileys socket lifecycle
- Coordinates AuthHandler and MessageHandler
- Implements auto-reconnection with exponential backoff
- Exposes ~200 public API methods
- Tracks connection states: `disconnected`, `connecting`, `connected`, `reconnecting`, `qr_required`

**Key Patterns:**
- Event emitter for `qr`, `ready`, `message`, `connection`, `session_saved` events
- Methods return result objects with `{ success: boolean, ... }` pattern
- Connection state checks before socket operations
- Graceful disconnect/logout with session cleanup

**In-Memory Stores** (populated via history sync):
- `contactsStore: Map<string, ContactInfo>` - Contact information
- `labelsStore: Map<string, Label>` - WhatsApp Business labels
- `messagesStore: Map<string, MiawMessage[]>` - Message history by JID
- `chatsStore: Map<string, ChatInfo>` - Chat metadata

**LruCache** (for privacy-masked JID resolution):
- Maps WhatsApp's `@lid` (privacy-masked) JIDs to actual phone JIDs
- Max size: 1000 entries, evicts least recently used
- Critical for contact resolution in privacy-focused accounts

#### 2. AuthHandler ([src/handlers/AuthHandler.ts](src/handlers/AuthHandler.ts))

Manages session persistence using Baileys' multi-file auth state.

**Session Structure:**
```
{sessionPath}/{instanceId}/
├── creds.json      # Authentication credentials
└── keys/           # Signal protocol keys
```

**Key Methods:**
- `initialize()` - Loads or creates auth state using `useMultiFileAuthState`
- `clearSession()` - Removes session files (needed for logout/re-authentication)
- `getAuthPath()` - Returns full session directory path

#### 3. MessageHandler ([src/handlers/MessageHandler.ts](src/handlers/MessageHandler.ts))

Converts complex Baileys message structures into normalized `MiawMessage` format.

**Normalization Features:**
- Handles view-once messages (v2 and v2 extension)
- Extracts media metadata (mimetype, fileSize, dimensions, duration)
- Formats JIDs consistently (`phone@s.whatsapp.net`, `groupId@g.us`)
- Distinguishes group messages from individual chats
- Supports: text, image, video, audio, document, sticker

**Key Methods:**
- `normalize(msg)` - Main message parser
- `extractImageMetadata()` - Image-specific metadata
- `formatPhoneToJid()` - Phone number to JID conversion
- `formatJidToPhone()` - JID to phone number extraction

### Event Flow

```
connect()
    ↓
AuthHandler.initialize()
    ↓
makeWASocket() (Baileys)
    ↓
registerSocketEvents()
    ↓
connection.update → emit('qr') | emit('ready') | handleDisconnect()
    ↓
messages.upsert → MessageHandler.normalize() → emit('message')
    ↓
creds.update → saveCreds() → emit('session_saved')
```

### Reconnection Logic

**Important**: Auto-reconnection behavior is controlled by:
- `autoReconnect: boolean` (default: true)
- `maxReconnectAttempts: number` (default: Infinity)
- `reconnectDelay: number` (default: 3000ms)

**Critical**: Will NOT reconnect if `DisconnectReason.loggedOut` is received (prevents infinite loops when user logs out from phone).

Always check this condition when modifying reconnection logic:
```typescript
const statusCode = (Boom.beBoom(lastDisconnect?.error)).output.statusCode;
if (statusCode === DisconnectReason.loggedOut) {
  // Don't reconnect - user logged out
}
```

### CLI Architecture

The CLI tool ([src/cli/](src/cli/)) is a separate subsystem with its own architecture:

**Key Components:**
- **REPL** ([src/cli/repl.ts](src/cli/repl.ts)) - Interactive shell with readline, command history, tab completion
- **Instance Registry** ([src/cli/utils/instance-registry.ts](src/cli/utils/instance-registry.ts)) - Centralized tracking of all MiawClient instances and connection states
- **Client Cache** ([src/cli/utils/client-cache.ts](src/cli/utils/client-cache.ts)) - Singleton cache for MiawClient instances (prevents duplicate connections)
- **Command Handlers** ([src/cli/commands/](src/cli/commands/)) - Modular command implementations

**Dispatch order invariant**: in `runCommand()`, the `instance` and `proxy` command
blocks are handled **before** `getOrCreateClient()` is called, because neither needs a
WhatsApp connection. New command blocks must go *after* that call unless they genuinely
work offline — appending one in the wrong place silently forces a client construction.

**REPL Features:**
- Auto-connects on start (uses existing session if available)
- Tab completion for commands, subcommands, and instance IDs
- Connection status in prompt: `miaw [connected] >`
- Commands: `help`, `status`, `use <instance-id>`, `connect`, `disconnect`, `debug on|off`, `instances`

**Instance Registry Pattern:**
- Single source of truth for instance states across CLI
- Auto-updates via event listeners on `connection` events
- Prevents state inconsistencies in multi-instance scenarios
- Key for "auto-switch on connect" feature

---

## Important Technical Details

### JID Format Convention

- Individual: `{phone}@s.whatsapp.net` (e.g., `6281234567890@s.whatsapp.net`)
- Groups: `{groupId}@g.us` (e.g., `1234567890@g.us`)
- Use `MessageHandler.formatPhoneToJid(phone)` for formatting
- Use `MessageHandler.formatJidToPhone(jid)` for extraction

**Phone number format**: International format without `+` or leading zeros
- ✅ Correct: `6281234567890`
- ❌ Wrong: `+6281234567890`, `081234567890`, `628-1234-567890`

### Session Management

Sessions are stored at `{sessionPath}/{instanceId}/` using Baileys' multi-file auth state format.

**First-time authentication**: Displays QR code (via `qrcode-terminal`), user scans with WhatsApp
**Subsequent connections**: Auto-loads session, no QR code needed
**Logout**: MUST call `clearSession()` after logout to allow fresh QR authentication

### Proxy Support

- The option is named **`proxy`**, not `proxyUrl`. It accepts a URL string or a
  `ProxyConfig` object. `agent` / `fetchAgent` are escape hatches that override it.
- `createProxyAgents()` ([src/utils/proxy-agent.ts](src/utils/proxy-agent.ts)) returns
  `{ wsAgent, fetchAgent, downloadDispatcher }`. **`wsAgent` and `fetchAgent` are the
  same `http.Agent`** — Baileys' upload path is `https.request({ agent })` on Node, so
  handing it an undici Dispatcher silently breaks every upload. `downloadDispatcher` is
  the undici Dispatcher, needed because downloads use `fetch(url, { dispatcher })`; it
  is **`undefined` for SOCKS** since undici has no SOCKS transport, so SOCKS downloads
  go direct. Baileys never plumbs a proxy into its download path, so `downloadMedia()`
  passes the dispatcher explicitly.
- **Never print a raw proxy URL.** Route everything — including error strings, which the
  proxy-agent libraries sometimes populate with the full URL — through `maskProxyUrl()`.
- Rotation ([src/utils/proxy-rotator.ts](src/utils/proxy-rotator.ts)) returns a
  `ProxyPoolEntry` for `new MiawClient({ proxy })`, deliberately not a pre-built agent:
  passing `agent` instead would make `resolveProxyAgents()` return early, disabling
  `getProxyInfo()` and dropping the `fetchAgent`.
- The default strategy is `deterministic` (rendezvous hashing on `instanceId`). **Do not
  rotate a live session's IP** — WhatsApp reads that as account takeover.
- `setProxy()` stages a proxy for the **next** `connect()` and never touches a live
  socket; it is refused outright when the client was built with a custom
  `agent`/`fetchAgent`, since those take precedence and would make it a silent no-op.
  `getProxyInfo()` returns `null` for such a client by design — that means "no
  miaw-core-managed proxy", not "no proxy".
- **CLI per-instance pins** live in `<sessionPath>/instances.json` (mode 0600), written
  only by [src/cli/utils/instance-config.ts](src/cli/utils/instance-config.ts). Precedence
  is resolved in one place,
  [src/cli/utils/proxy-resolver.ts](src/cli/utils/proxy-resolver.ts): `--proxy` >
  pin > `--proxy-file` > direct. Resolution happens at async boundaries and is keyed on
  the **target** instance — never reuse the startup instance's config for another
  instance.
- Every `instance` command handler takes a whole `ClientConfig`, never a
  `(sessionPath, instanceId)` pair: the pair silently dropped `proxy` and `debug`.
- The client cache key stays `instanceId:sessionPath` — adding the proxy would let one
  instance hold two entries, i.e. two sockets for one account. A proxy mismatch instead
  warns, and rebuilds **only** when the instance is disconnected.
- See [docs/PROXY.md](docs/PROXY.md).

### Browser Identity

- The `browser` option takes a `[os, browserName, version]` tuple. Use
  **`BrowserPresets`** ([src/utils/browser-presets.ts](src/utils/browser-presets.ts)),
  not Baileys' `Browsers`.
- **Never re-export Baileys' `Browsers` from `src/index.ts`, and never call it
  from `MiawClient`.** Every unit mock factory stubs it as `{ macOS }`
  alone, and `tests/unit/types.test.ts` imports `src/index.js` *without* mocking
  Baileys — either route drags the native bridge into the unit run. The presets
  duplicate Baileys' tuples deliberately; `tests/unit/browser-presets.test.ts`
  pins them against the real map so the duplication cannot drift silently.
- **Never use a `"Desktop"` browser name** — WhatsApp 428s it before issuing a QR.
- `BrowserPresets.android()` negotiates as an Android client, which is the only
  way to **receive view-once media**. Baileys marks it experimental. The tuple
  order is load-bearing: `browser[1]` must contain "android", since that is what
  `validate-connection.js` sniffs to pick `Platform.ANDROID`.

### Group vs Community Admin

Baileys gives groups and communities **byte-identical signatures** for every
settings and join-request method. Both surfaces therefore bind to three shared
private helpers in `MiawClient` — `runGroupAdmin`, `fetchJoinRequests`,
`updateJoinRequests`. When adding to that family, extend the helper rather than
writing a fourth pair of near-identical bodies, and add a test to
`tests/unit/group-community-admin.test.ts` for **both** surfaces — a copy-paste
slip binding a group method to a community socket call is the failure mode that
shape invites, and nothing in the compiler catches it.

Community JIDs are group JIDs, so the `@g.us` check applies to both.

### Wire Constants and the Mock Blind Spot

- **17 unit files replace `@whiskeysockets/baileys` wholesale** with hand-written
  `jest.unstable_mockModule` factories that snapshot the rc-era export surface.
  A green unit suite therefore proves nothing about a Baileys upgrade.
  `tests/unit/baileys-export-surface.test.ts` is the counterweight: it imports
  the **real** module and asserts every symbol the two import sites destructure.
  Add to it whenever you add a Baileys import.
- `MiawClient` deliberately does **not** import `proto`. Where a protobuf enum
  value is needed (`PinInChat.Type`), it is a *named* local constant, and the
  export-surface suite pins it against the real enum. Importing `proto` would
  force a `proto` entry into every mock factory.

### Duration Constants

Two different duration sets exist and are easy to confuse:

| Constant | Values | Used by |
|---|---|---|
| `EphemeralDuration` | `Off`, 24h, 7d, **90d** | `setChatEphemeral`, `setGroupEphemeral`, `setCommunityEphemeral`, `setDefaultDisappearingMode` |
| `PinDuration` | 24h, 7d, **30d** | `pinMessage` |

Note also that `setChatEphemeral` maps `0` to `false` (Baileys does not treat 0
as "off" on the `sendMessage` path) while `setDefaultDisappearingMode` passes `0`
straight through. That asymmetry is intentional and covered by tests.

### Adding New Client Methods

When adding new methods to MiawClient:

1. Check connection state before socket operations:
   ```typescript
   if (!this.socket) {
     return { success: false, error: "Not connected" };
   }
   ```

2. Return result objects with `success` boolean:
   ```typescript
   return { success: true, data: result };
   // or
   return { success: false, error: "Error message" };
   ```

3. Export types in [src/types/index.ts](src/types/index.ts)

4. Export in [src/index.ts](src/index.ts) if public API

### Testing Requirements

**Integration tests** require a real WhatsApp connection:
1. Copy `.env.test.example` to `.env.test`
2. Configure test phone number
3. First run: Scan QR code to authenticate
4. Subsequent runs: Auto-connects with saved session

See [tests/README.md](tests/README.md) for detailed testing guide.

**Interactive testing**: Use `npm run test:manual` to drive the API against a real WhatsApp connection. This is the fastest way to verify functionality during development. Run with `DEBUG=true` when chasing a protocol issue — it otherwise suppresses libsignal/Baileys chatter.

**CLI integration tests**: 13 files in `tests/integration/cli/`. Key architecture:

- Shared setup in `cli-setup.ts` pre-warms the client cache via `getOrCreateClient()` so `runCommand()` finds the connected client
- All files share one WhatsApp connection (`--runInBand`); only the last file disconnects
- Connection-dependent tests skip with `if (!isConnected()) return;`
- Console output assertions use `captureConsole()` in `try/finally` blocks
- Exception: `11-proxy-commands.test.ts` and `12-instance-proxy-commands.test.ts`
  need no connection at all (those commands dispatch before `getOrCreateClient()`),
  so they run unconditionally and offline
- **Teardown lives in the last CONNECTION-USING file**, currently
  `13-privacy-call-commands.test.ts` — not the last file overall, since 11 and 12
  sort after the connected ones but are offline. Putting it elsewhere disconnects
  the socket out from under a later file. Both headers say so; nothing enforces it.
- The connection guards `return` rather than `it.skip`, so a disconnected run
  reports **all-green while exercising almost nothing**. Trust the
  `=== CLI TEST CLIENT CONNECTED ===` banner, not the pass count.

---

## TypeScript Configuration

- **Target**: ES2022
- **Module**: ESNext with bundler resolution
- **Strict mode**: Enabled
- **Output**: `dist/` directory with declaration files
- **Important**: Uses `verbatimModuleSyntax: false` for ESM/tsx compatibility

---

## Dependencies

**Core:**
- `@whiskeysockets/baileys` (v7.0.0-rc14) - WhatsApp Web protocol
- `pino` - Structured logging
- `@hapi/boom` - HTTP-friendly error objects
- `qrcode-terminal` - QR code display in terminal
- `cli-table3` - CLI table formatting
- `https-proxy-agent` / `socks-proxy-agent` - proxy agents for the WebSocket transport
- `undici` - proxy dispatcher for media *downloads*. **No SOCKS support** - see Proxy Support below

**Dev:**
- `jest` + `ts-jest` - Testing framework
- `typescript` - Type checking
- `eslint` + `typescript-eslint` - Linting
- `tsx` - TypeScript execution for CLI

---

## Project Structure

```
bin/
└── miaw-cli.ts         # CLI entry point (one-shot + REPL)

src/
├── client/             # MiawClient - main entry point
├── handlers/           # AuthHandler, MessageHandler
├── types/              # TypeScript type definitions
├── constants/          # Shared constant tables
├── utils/              # proxy-agent, proxy-rotator, proxy-loader,
│                       #   browser-presets, type-guards
├── cli/                # CLI tool implementation
│   ├── commands/       # Command handlers (incl. privacy.ts, call.ts)
│   └── utils/          # CLI utilities (registry, cache, session,
│                       #   parse-args, proxy-resolver, instance-config)
└── index.ts            # Public API exports

docs/                   # Documentation
│   # Current
├── CLI.md             # CLI usage guide
├── USAGE.md           # Complete API usage guide
├── PROXY.md           # Proxy guide (files, rotation, troubleshooting)
├── DEPLOYMENT_PROXY.md          # Deploying with proxies (v1.10.0)
├── DEPLOYMENT_INSTANCE_PROXY.md # Per-instance proxy pins (v1.11.0)
├── DEPLOYMENT_V1.12.0.md        # Operator notes for the rc14 release
├── LID_RESOLUTION.md  # Privacy-masked (@lid) JID resolution guide
├── ROADMAP.md         # Feature roadmap
├── DEFERRED_FEATURES.md  # Backlog of deferred Baileys features (empty)
├── FOLLOW_UPS.md      # Open defects and debt
├── MIGRATION.md       # Version migration guide
├── CLI_INTEGRATION_TEST_PLAN.md  # CLI suite layout and ownership
├── BAILEYS_VS_MIAW_COMPARISON.md # Comparison with raw Baileys
├── TEST_COVERAGE_ANALYSIS.md     # API coverage report - PARTLY STALE,
│                                 #   see its own banner before trusting it
│   # Superseded, each carries a banner
├── API_STABILITY_REVIEW.md       # v1.0.0 release review
├── CLI-ANALYSIS.md               # v1.1.1 CLI gap analysis
├── CODE_REVIEW_REPORT.md         # v1.1.1 -> v1.2.0 review
└── BAILEYS_MIGRATION_v7.md       # rc.9 migration history

tests/
├── fixtures/           # Test assets (images, documents)
├── integration/        # Integration tests (require real WhatsApp)
│   └── cli/           # CLI command tests (13 files)
├── unit/              # Unit tests
└── README.md          # Testing guide

examples/              # Code examples and sample bots
```

---

## Common Patterns

### Reading Messages with LID Resolution

When dealing with privacy-focused accounts, contacts may use `@lid` JIDs instead of phone numbers:

```typescript
// The LruCache automatically handles @lid to phone mapping
// Just use the message as-is, miaw-core resolves it internally
client.on("message", (message) => {
  console.log(message.senderPhone);  // Resolved to actual phone if available
});
```

### Multi-Instance Management

Each instance needs a unique `instanceId`:

```typescript
const bot1 = new MiawClient({ instanceId: "bot1", sessionPath: "./sessions" });
const bot2 = new MiawClient({ instanceId: "bot2", sessionPath: "./sessions" });

// Sessions are isolated: ./sessions/bot1/ and ./sessions/bot2/
```

### Error Handling

Methods return result objects instead of throwing:

```typescript
const result = await client.sendText(phone, "Hello");
if (result.success) {
  console.log("Sent:", result.messageId);
} else {
  console.error("Failed:", result.error);
}
```

### Disconnection Handling

Always clean up reconnect timers and check disconnect reason:

```typescript
private handleDisconnect(lastDisconnect: any) {
  // Clear existing timer
  if (this.reconnectTimer) {
    clearTimeout(this.reconnectTimer);
  }

  // Check if logged out
  const statusCode = (Boom.beBoom(lastDisconnect?.error)).output.statusCode;
  if (statusCode === DisconnectReason.loggedOut) {
    this.connectionState = "disconnected";
    this.emit("connection", "disconnected");
    return;  // Don't reconnect
  }

  // Update state before reconnecting
  this.connectionState = "reconnecting";
  this.emit("connection", "reconnecting");
}
```

---

## Related Projects

This is part of the **Miaw** monorepo. The sibling project is:

- **miaw-api** - REST API wrapper for miaw-core (Fastify + TypeScript)

See the parent repository's CLAUDE.md for monorepo-wide guidance.
