/**
 * Unit tests for checkNumbers batch behavior (API report ISSUE-01).
 * Baileys onWhatsApp omits non-existent numbers; checkNumbers must return
 * one entry per input, preserving order, with exists:false for the missing.
 */

import { jest, describe, beforeEach, it, expect } from "@jest/globals";

jest.unstable_mockModule("@whiskeysockets/baileys", () => ({
  default: jest.fn(),
  makeWASocket: jest.fn(),
  DisconnectReason: { loggedOut: 401 },
  fetchLatestBaileysVersion: jest
    .fn<() => Promise<unknown>>()
    .mockResolvedValue({ version: [2, 2413, 1] }),
  fetchLatestWaWebVersion: jest
    .fn<() => Promise<unknown>>()
    .mockResolvedValue({ version: [2, 2413, 1], isLatest: true }),
  DEFAULT_CONNECTION_CONFIG: { version: [2, 2413, 1] },
  makeCacheableSignalKeyStore: jest.fn(),
  Browsers: { macOS: jest.fn(() => ["macOS", "Chrome", "1.0"]) },
  useMultiFileAuthState: jest.fn(),
  downloadMediaMessage: jest.fn(),
  jidNormalizedUser: jest.fn((jid: string) => jid),
  getAggregateVotesInPollMessage: jest.fn(),
}));

const { MiawClient } = await import("../../src/client/MiawClient.js");

const socketMocks = {
  onWhatsApp: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
};

function makeConnectedClient(): any {
  const client: any = new MiawClient({ instanceId: "test-check" });
  client.connectionState = "connected";
  client.socket = socketMocks;
  return client;
}

describe("checkNumbers batch (ISSUE-01)", () => {
  beforeEach(() => {
    socketMocks.onWhatsApp.mockReset();
  });

  it("returns one entry per input, marking omitted numbers as non-existent", async () => {
    const client = makeConnectedClient();
    // Baileys returns only the existing number
    socketMocks.onWhatsApp.mockResolvedValue([
      { exists: true, jid: "6285731297876@s.whatsapp.net" },
    ]);

    const input = ["6285731297876", "628123456789", "6281234567890"];
    const result = await client.checkNumbers(input);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      exists: true,
      jid: "6285731297876@s.whatsapp.net",
    });
    expect(result[1]).toEqual({ exists: false, jid: undefined });
    expect(result[2]).toEqual({ exists: false, jid: undefined });
  });

  it("preserves input order when results come back unordered", async () => {
    const client = makeConnectedClient();
    socketMocks.onWhatsApp.mockResolvedValue([
      { exists: true, jid: "628222@s.whatsapp.net" },
      { exists: true, jid: "628111@s.whatsapp.net" },
    ]);

    const result = await client.checkNumbers(["628111", "628999", "628222"]);

    expect(result[0]).toEqual({ exists: true, jid: "628111@s.whatsapp.net" });
    expect(result[1]).toEqual({ exists: false, jid: undefined });
    expect(result[2]).toEqual({ exists: true, jid: "628222@s.whatsapp.net" });
  });

  it("matches even when baileys returns a device-suffixed jid", async () => {
    const client = makeConnectedClient();
    socketMocks.onWhatsApp.mockResolvedValue([
      { exists: true, jid: "628111:12@s.whatsapp.net" },
    ]);

    const result = await client.checkNumbers(["628111", "628222"]);

    expect(result[0].exists).toBe(true);
    expect(result[1]).toEqual({ exists: false, jid: undefined });
  });
});
