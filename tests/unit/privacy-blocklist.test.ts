/**
 * Unit tests for v1.12.0 privacy settings and the blocklist.
 *
 * Fake socket with the privacy/block mocks; no real connection.
 *
 * The mapping in getPrivacySettings() is the interesting part: WhatsApp returns
 * a flat map keyed by its own category names (`last`, `calladd`, `readreceipts`
 * ...), which do not match our field names, so the tests pin that translation
 * against the categories Baileys actually queries in Socket/chats.js.
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

const PHONE = "6281234567890";
const JID = "6281234567890@s.whatsapp.net";

const socketMocks = {
  updateBlockStatus: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  fetchBlocklist: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  fetchPrivacySettings: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  updateLastSeenPrivacy: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  updateOnlinePrivacy: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  updateProfilePicturePrivacy: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  updateStatusPrivacy: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  updateReadReceiptsPrivacy: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  updateGroupsAddPrivacy: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  updateMessagesPrivacy: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  updateCallPrivacy: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  updateDefaultDisappearingMode: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  updateDisableLinkPreviewsPrivacy: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
};

function makeConnectedClient(): any {
  const client: any = new MiawClient({ instanceId: "test-privacy" });
  client.connectionState = "connected";
  client.socket = socketMocks;
  return client;
}

function makeDisconnectedClient(): any {
  const client: any = new MiawClient({ instanceId: "test-privacy" });
  client.connectionState = "disconnected";
  client.socket = null;
  return client;
}

describe("v1.12.0 privacy & blocklist", () => {
  beforeEach(() => {
    Object.values(socketMocks).forEach((m) =>
      m.mockReset().mockResolvedValue(undefined)
    );
  });

  describe("blocklist", () => {
    it("blockContact formats a phone number and sends 'block'", async () => {
      const client = makeConnectedClient();

      const res = await client.blockContact(PHONE);

      expect(res).toEqual({ success: true });
      expect(socketMocks.updateBlockStatus).toHaveBeenCalledWith(JID, "block");
    });

    it("unblockContact sends 'unblock'", async () => {
      const client = makeConnectedClient();

      await client.unblockContact(PHONE);

      expect(socketMocks.updateBlockStatus).toHaveBeenCalledWith(JID, "unblock");
    });

    it("accepts a JID unchanged", async () => {
      const client = makeConnectedClient();

      await client.blockContact(JID);

      expect(socketMocks.updateBlockStatus).toHaveBeenCalledWith(JID, "block");
    });

    it("getBlocklist drops the undefined holes Baileys can return", async () => {
      socketMocks.fetchBlocklist.mockResolvedValue([JID, undefined, "6289@s.whatsapp.net"]);
      const client = makeConnectedClient();

      await expect(client.getBlocklist()).resolves.toEqual([
        JID,
        "6289@s.whatsapp.net",
      ]);
    });

    it("getBlocklist returns [] when WhatsApp returns nothing", async () => {
      socketMocks.fetchBlocklist.mockResolvedValue(undefined);
      const client = makeConnectedClient();

      await expect(client.getBlocklist()).resolves.toEqual([]);
    });

    it("isBlocked matches on the formatted JID, not the raw phone", async () => {
      socketMocks.fetchBlocklist.mockResolvedValue([JID]);
      const client = makeConnectedClient();

      await expect(client.isBlocked(PHONE)).resolves.toBe(true);
    });

    it("isBlocked is false for a number that is not listed", async () => {
      socketMocks.fetchBlocklist.mockResolvedValue([JID]);
      const client = makeConnectedClient();

      await expect(client.isBlocked("6289999999999")).resolves.toBe(false);
    });

    it("surfaces a block failure as an error result", async () => {
      socketMocks.updateBlockStatus.mockRejectedValue(new Error("nope"));
      const client = makeConnectedClient();

      await expect(client.blockContact(PHONE)).resolves.toEqual({
        success: false,
        error: "nope",
      });
    });
  });

  describe("getPrivacySettings", () => {
    it("maps WhatsApp's category keys onto typed fields", async () => {
      socketMocks.fetchPrivacySettings.mockResolvedValue({
        last: "contacts",
        online: "match_last_seen",
        profile: "all",
        status: "contact_blacklist",
        readreceipts: "none",
        groupadd: "contacts",
        messages: "all",
        calladd: "known",
      });
      const client = makeConnectedClient();

      const settings = await client.getPrivacySettings();

      expect(settings).toMatchObject({
        lastSeen: "contacts",
        online: "match_last_seen",
        profilePicture: "all",
        status: "contact_blacklist",
        readReceipts: "none",
        groupAdd: "contacts",
        messages: "all",
        calls: "known",
      });
    });

    it("keeps the unnormalized map under raw, including unknown keys", async () => {
      socketMocks.fetchPrivacySettings.mockResolvedValue({
        last: "all",
        somethingNew: "whatever",
      });
      const client = makeConnectedClient();

      const settings = await client.getPrivacySettings();

      expect(settings.raw).toEqual({ last: "all", somethingNew: "whatever" });
      expect(settings.lastSeen).toBe("all");
    });

    it("leaves absent categories undefined rather than inventing defaults", async () => {
      socketMocks.fetchPrivacySettings.mockResolvedValue({ last: "all" });
      const client = makeConnectedClient();

      const settings = await client.getPrivacySettings();

      expect(settings.online).toBeUndefined();
      expect(settings.calls).toBeUndefined();
    });

    it("defaults force to false and forwards it when asked", async () => {
      socketMocks.fetchPrivacySettings.mockResolvedValue({});
      const client = makeConnectedClient();

      await client.getPrivacySettings();
      expect(socketMocks.fetchPrivacySettings).toHaveBeenCalledWith(false);

      await client.getPrivacySettings(true);
      expect(socketMocks.fetchPrivacySettings).toHaveBeenCalledWith(true);
    });

    it("returns null on failure", async () => {
      socketMocks.fetchPrivacySettings.mockRejectedValue(new Error("boom"));
      const client = makeConnectedClient();

      await expect(client.getPrivacySettings()).resolves.toBeNull();
    });
  });

  describe("privacy setters", () => {
    it.each([
      ["setLastSeenPrivacy", "updateLastSeenPrivacy", "contacts"],
      ["setOnlinePrivacy", "updateOnlinePrivacy", "match_last_seen"],
      ["setProfilePicturePrivacy", "updateProfilePicturePrivacy", "all"],
      ["setStatusPrivacy", "updateStatusPrivacy", "none"],
      ["setReadReceiptsPrivacy", "updateReadReceiptsPrivacy", "none"],
      ["setGroupAddPrivacy", "updateGroupsAddPrivacy", "contact_blacklist"],
      ["setMessagesPrivacy", "updateMessagesPrivacy", "contacts"],
      ["setCallPrivacy", "updateCallPrivacy", "known"],
    ])("%s calls %s with the value", async (method, socketMethod, value) => {
      const client = makeConnectedClient();

      const res = await client[method](value);

      expect(res).toEqual({ success: true });
      expect(
        socketMocks[socketMethod as keyof typeof socketMocks]
      ).toHaveBeenCalledWith(value);
    });

    it("setDefaultDisappearingMode forwards the duration in seconds", async () => {
      const client = makeConnectedClient();

      await client.setDefaultDisappearingMode(604800);

      expect(socketMocks.updateDefaultDisappearingMode).toHaveBeenCalledWith(
        604800
      );
    });

    it("setDefaultDisappearingMode passes 0 through, unlike setChatEphemeral", async () => {
      // updateDefaultDisappearingMode takes a duration, not a boolean, so 0
      // really does mean "off" here -- no false-mapping.
      const client = makeConnectedClient();

      await client.setDefaultDisappearingMode(0);

      expect(socketMocks.updateDefaultDisappearingMode).toHaveBeenCalledWith(0);
    });

    it.each([true, false])(
      "setLinkPreviewsDisabled(%s) forwards the boolean",
      async (disabled) => {
        const client = makeConnectedClient();

        await client.setLinkPreviewsDisabled(disabled);

        expect(
          socketMocks.updateDisableLinkPreviewsPrivacy
        ).toHaveBeenCalledWith(disabled);
      }
    );

    it("surfaces a setter failure as an error result", async () => {
      socketMocks.updateLastSeenPrivacy.mockRejectedValue(new Error("denied"));
      const client = makeConnectedClient();

      await expect(client.setLastSeenPrivacy("all")).resolves.toEqual({
        success: false,
        error: "denied",
      });
    });
  });

  describe("connection guards", () => {
    it("setters return an error result when not connected", async () => {
      const client = makeDisconnectedClient();

      const res = await client.setLastSeenPrivacy("all");

      expect(res.success).toBe(false);
      expect(res.error).toContain("Not connected");
      expect(socketMocks.updateLastSeenPrivacy).not.toHaveBeenCalled();
    });

    it("blockContact returns an error result when not connected", async () => {
      const client = makeDisconnectedClient();

      const res = await client.blockContact(PHONE);

      expect(res.success).toBe(false);
      expect(res.error).toContain("Not connected");
    });

    it("getBlocklist returns [] when not connected", async () => {
      const client = makeDisconnectedClient();

      await expect(client.getBlocklist()).resolves.toEqual([]);
    });

    it("getPrivacySettings returns null when not connected", async () => {
      const client = makeDisconnectedClient();

      await expect(client.getPrivacySettings()).resolves.toBeNull();
    });
  });
});
