/**
 * Unit tests for group admin operations returning LID (API report ISSUE-07).
 * promote/demote must return @s.whatsapp.net jids (resolved from @lid) so
 * results correlate with the GET participants list, which is also resolved.
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

const GJID = "120363412292735633@g.us";

const socketMocks = {
  groupParticipantsUpdate: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
};

function makeConnectedClient(): any {
  const client: any = new MiawClient({ instanceId: "test-group-admin" });
  client.connectionState = "connected";
  client.socket = socketMocks;
  return client;
}

describe("group admin LID resolution (ISSUE-07)", () => {
  beforeEach(() => {
    socketMocks.groupParticipantsUpdate.mockReset();
  });

  it("resolves a returned @lid jid back to @s.whatsapp.net when mapping known", async () => {
    const client = makeConnectedClient();
    client.addLidMapping(
      "217883841982581@lid",
      "6285731297876@s.whatsapp.net",
      "Test"
    );
    socketMocks.groupParticipantsUpdate.mockResolvedValue([
      { jid: "217883841982581@lid", status: "200" },
    ]);

    const result = await client.promoteToAdmin(GJID, ["6285731297876"]);

    expect(result[0]).toEqual({
      jid: "6285731297876@s.whatsapp.net",
      status: "200",
      success: true,
    });
  });

  it("falls back to the raw jid when no LID mapping is known", async () => {
    const client = makeConnectedClient();
    socketMocks.groupParticipantsUpdate.mockResolvedValue([
      { jid: "999999999@lid", status: "200" },
    ]);

    const result = await client.demoteFromAdmin(GJID, ["6285731297876"]);

    expect(result[0].jid).toBe("999999999@lid");
    expect(result[0].success).toBe(true);
  });
});
