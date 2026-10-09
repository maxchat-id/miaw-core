/**
 * Unit tests for the connection state handleDisconnect() reports.
 *
 * `restartRequired` (515) is WhatsApp's post-pairing handshake step: the socket
 * must be rebuilt immediately with the credentials just issued. handleDisconnect
 * reported it as `disconnected` — indistinguishable from an idle instance — so
 * miaw-api's connectIfIdle() guard let an external connect() land in the middle
 * of the handshake. WhatsApp then rejected the abandoned registration with
 * loggedOut (401) and clearSession() wiped the fresh credentials, sending the
 * user back to the QR screen. Reproduced repeatedly on staging 2026-08-19.
 *
 * A disconnect the client intends to recover from must therefore read as
 * `reconnecting`, and one it will not recover from as `disconnected`.
 */

import { jest, describe, beforeEach, afterEach, it, expect } from "@jest/globals";

jest.unstable_mockModule("@whiskeysockets/baileys", () => ({
  default: jest.fn(),
  makeWASocket: jest.fn(),
  // Numeric enums carry a reverse mapping, which is how handleDisconnect turns
  // a status code back into a reason string.
  DisconnectReason: {
    loggedOut: 401,
    connectionClosed: 428,
    connectionReplaced: 440,
    restartRequired: 515,
    timedOut: 408,
    401: "loggedOut",
    428: "connectionClosed",
    440: "connectionReplaced",
    515: "restartRequired",
    408: "timedOut",
  },
  fetchLatestBaileysVersion: jest
    .fn<() => Promise<unknown>>()
    .mockResolvedValue({ version: [2, 3000, 1] }),
  fetchLatestWaWebVersion: jest
    .fn<() => Promise<unknown>>()
    .mockResolvedValue({ version: [2, 3000, 1], isLatest: true }),
  DEFAULT_CONNECTION_CONFIG: { version: [2, 3000, 1] },
  makeCacheableSignalKeyStore: jest.fn(),
  Browsers: { macOS: jest.fn(() => ["macOS", "Desktop", "1.0"]) },
  useMultiFileAuthState: jest.fn(),
  downloadMediaMessage: jest.fn(),
  jidNormalizedUser: jest.fn((jid: string) => jid),
  getAggregateVotesInPollMessage: jest.fn(),
}));

const { MiawClient } = await import("../../src/client/MiawClient.js");

function makeClient(options: Record<string, unknown> = {}): any {
  const client: any = new MiawClient({
    instanceId: "test-disconnect-state",
    sessionPath: "./sessions-test",
    ...options,
  });
  // No filesystem work, and no real reconnect.
  client.authHandler.clearSession = jest.fn();
  client.connect = jest.fn();
  return client;
}

/** A Boom-shaped lastDisconnect carrying `statusCode`. */
function disconnectWith(statusCode: number): unknown {
  return { error: { output: { statusCode } } };
}

describe("handleDisconnect connection state", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reports restartRequired as reconnecting, not disconnected", () => {
    const client = makeClient();
    const states: string[] = [];
    client.on("connection", (state: string) => states.push(state));

    const shouldReconnect = client.handleDisconnect(disconnectWith(515));

    expect(shouldReconnect).toBe(true);
    expect(client.connectionState).toBe("reconnecting");
    expect(states).toEqual(["reconnecting"]);
  });

  it("reports an ordinary recoverable drop as reconnecting", () => {
    const client = makeClient();

    const shouldReconnect = client.handleDisconnect(disconnectWith(408));

    expect(shouldReconnect).toBe(true);
    expect(client.connectionState).toBe("reconnecting");
  });

  it("reports loggedOut as disconnected and invalidates message state", () => {
    const client = makeClient();
    client.messagesStore.set("old@s.whatsapp.net", [{ id: "OLD" }]);
    client.messageIdIndex.set("old@s.whatsapp.net", new Map([["OLD", 0]]));
    client.currentMessageRevision = 1;
    client.messageCheckpointTimer = setTimeout(() => {}, 10_000);

    const shouldReconnect = client.handleDisconnect(disconnectWith(401));

    expect(shouldReconnect).toBe(false);
    expect(client.connectionState).toBe("disconnected");
    expect(client.authHandler.clearSession).toHaveBeenCalledTimes(1);
    expect(client.messagesStore.size).toBe(0);
    expect(client.messageIdIndex.size).toBe(0);
    expect(client.currentMessageRevision).toBe(0);
    expect(client.messageCheckpointTimer).toBeNull();
    expect(client.persistenceEpoch).toBe(1);
  });

  it("reports connectionReplaced as disconnected without clearing the session", () => {
    const client = makeClient();

    const shouldReconnect = client.handleDisconnect(disconnectWith(440));

    expect(shouldReconnect).toBe(false);
    expect(client.connectionState).toBe("disconnected");
    expect(client.authHandler.clearSession).not.toHaveBeenCalled();
  });

  it("reports a deliberate logout as disconnected", () => {
    const client = makeClient();
    client.loggingOut = true;

    const shouldReconnect = client.handleDisconnect(disconnectWith(428));

    expect(shouldReconnect).toBe(false);
    expect(client.connectionState).toBe("disconnected");
  });

  it("reports disconnected when autoReconnect is off, since nothing will reconnect", () => {
    const client = makeClient({ autoReconnect: false });

    client.handleDisconnect(disconnectWith(515));

    expect(client.connectionState).toBe("disconnected");
  });

  it("still emits the disconnected event with the reason and status code", () => {
    const client = makeClient();
    const seen: unknown[][] = [];
    client.on("disconnected", (...args: unknown[]) => seen.push(args));

    client.handleDisconnect(disconnectWith(515));

    expect(seen).toEqual([["restartRequired", 515]]);
  });
});
