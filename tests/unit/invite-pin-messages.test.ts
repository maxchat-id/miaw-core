/**
 * Unit tests for v1.12.0 group-invite messages and pin-in-chat.
 *
 * Fake socket with a sendMessage mock; no real connection.
 *
 * The pin path encodes proto.PinInChat.Type as named local constants rather
 * than importing `proto` (see setMessagePin), so these tests pin the wire values
 * 1 and 2 — nothing else in the build would catch them drifting.
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
const { PinDuration } = await import("../../src/types/index.js");

const GJID = "120363000000000001@g.us";
const CHAT = "6281234567890@s.whatsapp.net";

const sendMessageMock = jest.fn<(...a: unknown[]) => Promise<any>>();

function makeConnectedClient(): any {
  const client: any = new MiawClient({ instanceId: "test-invite-pin" });
  client.connectionState = "connected";
  client.socket = { sendMessage: sendMessageMock };
  return client;
}

const pinnableMessage = {
  id: "MSG1",
  from: CHAT,
  raw: { key: { id: "MSG1", remoteJid: CHAT, fromMe: true } },
};

describe("v1.12.0 group invites & pinning", () => {
  beforeEach(() => {
    sendMessageMock.mockReset().mockResolvedValue({ key: { id: "SENT1" } });
  });

  describe("sendGroupInvite", () => {
    const invite = {
      groupJid: GJID,
      groupName: "My Group",
      inviteCode: "AbCdEf123",
      expiration: 1700000000,
      caption: "Come join",
    };

    it("maps our field names onto the Baileys groupInvite payload", async () => {
      const client = makeConnectedClient();

      const res = await client.sendGroupInvite("6289999999999", invite);

      expect(res).toEqual({ success: true, messageId: "SENT1" });
      expect(sendMessageMock).toHaveBeenCalledWith(
        "6289999999999@s.whatsapp.net",
        {
          groupInvite: {
            jid: GJID,
            subject: "My Group",
            inviteCode: "AbCdEf123",
            inviteExpiration: 1700000000,
            text: "Come join",
          },
        }
      );
    });

    it("sends an empty caption rather than undefined when omitted", async () => {
      const client = makeConnectedClient();
      const { caption: _caption, ...noCaption } = invite;

      await client.sendGroupInvite("6289999999999", noCaption);

      const payload = sendMessageMock.mock.calls[0][1] as any;
      expect(payload.groupInvite.text).toBe("");
    });

    it("rejects a group JID that is not a group JID", async () => {
      const client = makeConnectedClient();

      const res = await client.sendGroupInvite("6289999999999", {
        ...invite,
        groupJid: CHAT,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("@g.us");
      expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it("returns an error result when not connected", async () => {
      const client: any = new MiawClient({ instanceId: "test-disc" });

      const res = await client.sendGroupInvite("6289999999999", invite);

      expect(res.success).toBe(false);
      expect(res.error).toContain("Not connected");
    });
  });

  describe("pinMessage", () => {
    it("sends PIN_FOR_ALL (1) with the default 24h duration", async () => {
      const client = makeConnectedClient();

      const res = await client.pinMessage(pinnableMessage);

      expect(res).toEqual({ success: true, messageId: "SENT1" });
      expect(sendMessageMock).toHaveBeenCalledWith(CHAT, {
        pin: pinnableMessage.raw.key,
        type: 1,
        time: 86400,
      });
    });

    it.each([
      [PinDuration.TwentyFourHours, 86400],
      [PinDuration.SevenDays, 604800],
      [PinDuration.ThirtyDays, 2592000],
    ])("accepts the %s duration", async (duration, expected) => {
      const client = makeConnectedClient();

      await client.pinMessage(pinnableMessage, duration);

      const payload = sendMessageMock.mock.calls[0][1] as any;
      expect(payload.time).toBe(expected);
    });

    it("rejects a message with no raw key", async () => {
      const client = makeConnectedClient();

      const res = await client.pinMessage({ id: "x" });

      expect(res.success).toBe(false);
      expect(res.error).toContain("raw Baileys key");
      expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it("rejects a message whose key has no chat JID", async () => {
      const client = makeConnectedClient();

      const res = await client.pinMessage({
        id: "x",
        raw: { key: { id: "x" } },
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("chat JID");
    });
  });

  describe("unpinMessage", () => {
    it("sends UNPIN_FOR_ALL (2) and omits time", async () => {
      const client = makeConnectedClient();

      const res = await client.unpinMessage(pinnableMessage);

      expect(res).toEqual({ success: true, messageId: "SENT1" });
      expect(sendMessageMock).toHaveBeenCalledWith(CHAT, {
        pin: pinnableMessage.raw.key,
        type: 2,
      });
      // WhatsApp ignores `time` when unpinning; sending one anyway is noise.
      const payload = sendMessageMock.mock.calls[0][1] as any;
      expect(payload).not.toHaveProperty("time");
    });

    it("surfaces a send failure as an error result", async () => {
      sendMessageMock.mockRejectedValue(new Error("not allowed"));
      const client = makeConnectedClient();

      await expect(client.unpinMessage(pinnableMessage)).resolves.toEqual({
        success: false,
        error: "not allowed",
      });
    });

    it("returns an error result when not connected", async () => {
      const client: any = new MiawClient({ instanceId: "test-disc" });

      const res = await client.unpinMessage(pinnableMessage);

      expect(res.success).toBe(false);
      expect(res.error).toContain("Not connected");
    });
  });
});
