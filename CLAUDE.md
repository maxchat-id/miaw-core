# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**miaw-core** is a TypeScript library that simplifies the Baileys WhatsApp Web API. It abstracts away session management, QR code handling, reconnection logic, and message normalization, providing a clean event-driven API for WhatsApp automation with multi-instance support.

**Key abstraction**: miaw-core handles all Baileys boilerplate so developers can focus on bot logic instead of connection lifecycle, auth state management, and message parsing.

**Current Version**: 1.10.0
**Baileys Version**: 7.0.0-rc13
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

```bash
# Unit and integration tests (Jest)
npm test                    # Run all tests
npm run test:watch          # Watch mode
npm run test:coverage       # Generate coverage report

# CLI integration tests (99 tests, real WhatsApp connection)
npm run test:cli            # Run all CLI tests (skips if not connected)

# Interactive manual testing (80+ API methods)
npm run test:manual         # Show available test groups
npm run test:manual all     # Test all features
npm run test:manual messaging   # Test messaging only
npm run test:manual business    # Test business features
npm run test:manual newsletter  # Test newsletter/channels
```

The interactive test suite (`npm run test:manual`) provides comprehensive testing of all 92 API methods organized into 8 groups: core, get, messaging, contacts, group, profile, business, newsletter, and ux. See [Test Coverage Analysis](./docs/TEST_COVERAGE_ANALYSIS.md).

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
- Exposes 92 API methods across 8 categories
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
  `{ wsAgent, fetchAgent }`. `wsAgent` is a Node `http.Agent` that works for all four
  protocols and is usable directly with `https.request` — that is how the CLI probes a
  proxy without a WhatsApp connection. `fetchAgent` is an undici Dispatcher and is
  **`undefined` for SOCKS**, so media transfers fall back to a direct connection.
- **Never print a raw proxy URL.** Route everything — including error strings, which the
  proxy-agent libraries sometimes populate with the full URL — through `maskProxyUrl()`.
- Rotation ([src/utils/proxy-rotator.ts](src/utils/proxy-rotator.ts)) returns a
  `ProxyPoolEntry` for `new MiawClient({ proxy })`, deliberately not a pre-built agent:
  passing `agent` instead would make `resolveProxyAgents()` return early, disabling
  `getProxyInfo()` and dropping the `fetchAgent`.
- The default strategy is `deterministic` (rendezvous hashing on `instanceId`). **Do not
  rotate a live session's IP** — WhatsApp reads that as account takeover.
- See [docs/PROXY.md](docs/PROXY.md).

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

**Interactive testing**: Use `npm run test:manual` to test all 92 API methods with a real WhatsApp connection. This is the fastest way to verify functionality during development.

**CLI integration tests**: 99 tests across 11 files in `tests/integration/cli/`. Key architecture:

- Shared setup in `cli-setup.ts` pre-warms the client cache via `getOrCreateClient()` so `runCommand()` finds the connected client
- All files share one WhatsApp connection (`--runInBand`); only the last file disconnects
- Connection-dependent tests skip with `if (!isConnected()) return;`
- Console output assertions use `captureConsole()` in `try/finally` blocks
- Exception: `11-proxy-commands.test.ts` needs no connection at all (proxy commands
  dispatch before `getOrCreateClient()`), so it runs unconditionally and offline

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
- `@whiskeysockets/baileys` (v7.0.0-rc13) - WhatsApp Web protocol
- `pino` - Structured logging
- `@hapi/boom` - HTTP-friendly error objects
- `qrcode-terminal` - QR code display in terminal
- `cli-table3` - CLI table formatting
- `https-proxy-agent` / `socks-proxy-agent` - proxy agents for the WebSocket transport
- `undici` - proxy dispatcher for `fetch()` (media). **No SOCKS support** - see Proxy Support below

**Dev:**
- `jest` + `ts-jest` - Testing framework
- `typescript` - Type checking
- `eslint` + `typescript-eslint` - Linting
- `tsx` - TypeScript execution for CLI

---

## Project Structure

```
src/
├── client/             # MiawClient - main entry point
├── handlers/           # AuthHandler, MessageHandler
├── types/              # TypeScript type definitions
├── cli/                # CLI tool implementation
│   ├── commands/       # Command handlers
│   └── utils/          # CLI utilities (registry, cache, session)
└── index.ts            # Public API exports

docs/                   # Documentation
├── CLI.md             # CLI usage guide
├── USAGE.md           # Complete API usage guide
├── PROXY.md           # Proxy guide (files, rotation, troubleshooting)
├── LID_RESOLUTION.md  # Privacy-masked (@lid) JID resolution guide
├── ROADMAP.md         # Feature roadmap
├── DEFERRED_FEATURES.md  # Backlog of deliberately deferred Baileys features
├── MIGRATION.md       # Version migration guide
├── TEST_COVERAGE_ANALYSIS.md  # API coverage report
└── BAILEYS_VS_MIAW_COMPARISON.md  # Comparison with raw Baileys

tests/
├── fixtures/           # Test assets (images, documents)
├── integration/        # Integration tests (require real WhatsApp)
│   └── cli/           # CLI command tests (99 tests, 11 files)
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
