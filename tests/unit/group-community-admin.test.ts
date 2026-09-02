/**
 * Unit tests for v1.12.0 group & community admin: settings and join requests.
 *
 * Groups and communities share one implementation behind runGroupAdmin() /
 * fetchJoinRequests() / updateJoinRequests(), so these tests deliberately cover
 * BOTH surfaces rather than trusting the shared path once — the whole risk of
 * that refactor is a copy-paste slip binding a group method to a community
 * socket call or vice versa.
 *
 * Fake socket with the group and community admin mocks; no real connection.
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
const { EphemeralDuration } = await import("../../src/types/index.js");

const GJID = "120363000000000001@g.us";
const CJID = "120363000000000002@g.us";

const socketMocks = {
  groupSettingUpdate: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  groupMemberAddMode: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  groupJoinApprovalMode: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  groupToggleEphemeral: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  groupRequestParticipantsList: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  groupRequestParticipantsUpdate: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  communitySettingUpdate: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  communityMemberAddMode: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  communityJoinApprovalMode: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  communityToggleEphemeral: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  communityRequestParticipantsList: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  communityRequestParticipantsUpdate: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
};

function makeConnectedClient(): any {
  const client: any = new MiawClient({ instanceId: "test-admin" });
  client.connectionState = "connected";
  client.socket = socketMocks;
  return client;
}

function makeDisconnectedClient(): any {
  const client: any = new MiawClient({ instanceId: "test-admin" });
  client.connectionState = "disconnected";
  client.socket = null;
  return client;
}

describe("v1.12.0 group & community admin", () => {
  beforeEach(() => {
    Object.values(socketMocks).forEach((m) =>
      m.mockReset().mockResolvedValue(undefined)
    );
  });

  describe("group settings", () => {
    it.each([
      [true, "announcement"],
      [false, "not_announcement"],
    ])("setGroupAnnounceOnly(%s) sends %s", async (on, expected) => {
      const client = makeConnectedClient();

      const res = await client.setGroupAnnounceOnly(GJID, on);

      expect(res).toEqual({ success: true });
      expect(socketMocks.groupSettingUpdate).toHaveBeenCalledWith(GJID, expected);
    });

    it.each([
      [true, "locked"],
      [false, "unlocked"],
    ])("setGroupRestrictInfo(%s) sends %s", async (on, expected) => {
      const client = makeConnectedClient();

      const res = await client.setGroupRestrictInfo(GJID, on);

      expect(res).toEqual({ success: true });
      expect(socketMocks.groupSettingUpdate).toHaveBeenCalledWith(GJID, expected);
    });

    it("setGroupMemberAddMode passes the mode straight through", async () => {
      const client = makeConnectedClient();

      await client.setGroupMemberAddMode(GJID, "all_member_add");

      expect(socketMocks.groupMemberAddMode).toHaveBeenCalledWith(
        GJID,
        "all_member_add"
      );
    });

    it.each([
      [true, "on"],
      [false, "off"],
    ])("setGroupJoinApproval(%s) sends %s", async (on, expected) => {
      const client = makeConnectedClient();

      await client.setGroupJoinApproval(GJID, on);

      expect(socketMocks.groupJoinApprovalMode).toHaveBeenCalledWith(
        GJID,
        expected
      );
    });

    it("setGroupEphemeral forwards the duration in seconds", async () => {
      const client = makeConnectedClient();

      await client.setGroupEphemeral(GJID, EphemeralDuration.SevenDays);

      expect(socketMocks.groupToggleEphemeral).toHaveBeenCalledWith(
        GJID,
        604800
      );
    });

    it("setGroupEphemeral(Off) disables the timer with 0", async () => {
      const client = makeConnectedClient();

      await client.setGroupEphemeral(GJID, EphemeralDuration.Off);

      expect(socketMocks.groupToggleEphemeral).toHaveBeenCalledWith(GJID, 0);
    });
  });

  describe("community settings", () => {
    it.each([
      [true, "announcement"],
      [false, "not_announcement"],
    ])("setCommunityAnnounceOnly(%s) sends %s", async (on, expected) => {
      const client = makeConnectedClient();

      const res = await client.setCommunityAnnounceOnly(CJID, on);

      expect(res).toEqual({ success: true });
      expect(socketMocks.communitySettingUpdate).toHaveBeenCalledWith(
        CJID,
        expected
      );
    });

    it.each([
      [true, "locked"],
      [false, "unlocked"],
    ])("setCommunityRestrictInfo(%s) sends %s", async (on, expected) => {
      const client = makeConnectedClient();

      await client.setCommunityRestrictInfo(CJID, on);

      expect(socketMocks.communitySettingUpdate).toHaveBeenCalledWith(
        CJID,
        expected
      );
    });

    it("setCommunityMemberAddMode passes the mode straight through", async () => {
      const client = makeConnectedClient();

      await client.setCommunityMemberAddMode(CJID, "admin_add");

      expect(socketMocks.communityMemberAddMode).toHaveBeenCalledWith(
        CJID,
        "admin_add"
      );
    });

    it.each([
      [true, "on"],
      [false, "off"],
    ])("setCommunityJoinApproval(%s) sends %s", async (on, expected) => {
      const client = makeConnectedClient();

      await client.setCommunityJoinApproval(CJID, on);

      expect(socketMocks.communityJoinApprovalMode).toHaveBeenCalledWith(
        CJID,
        expected
      );
    });

    it("setCommunityEphemeral forwards the duration in seconds", async () => {
      const client = makeConnectedClient();

      await client.setCommunityEphemeral(CJID, EphemeralDuration.TwentyFourHours);

      expect(socketMocks.communityToggleEphemeral).toHaveBeenCalledWith(
        CJID,
        86400
      );
    });
  });

  describe("group and community calls do not cross wires", () => {
    it("group setters never touch the community socket methods", async () => {
      const client = makeConnectedClient();

      await client.setGroupAnnounceOnly(GJID, true);
      await client.setGroupMemberAddMode(GJID, "admin_add");
      await client.setGroupJoinApproval(GJID, true);
      await client.setGroupEphemeral(GJID, 86400);

      expect(socketMocks.communitySettingUpdate).not.toHaveBeenCalled();
      expect(socketMocks.communityMemberAddMode).not.toHaveBeenCalled();
      expect(socketMocks.communityJoinApprovalMode).not.toHaveBeenCalled();
      expect(socketMocks.communityToggleEphemeral).not.toHaveBeenCalled();
    });

    it("community setters never touch the group socket methods", async () => {
      const client = makeConnectedClient();

      await client.setCommunityAnnounceOnly(CJID, true);
      await client.setCommunityMemberAddMode(CJID, "admin_add");
      await client.setCommunityJoinApproval(CJID, true);
      await client.setCommunityEphemeral(CJID, 86400);

      expect(socketMocks.groupSettingUpdate).not.toHaveBeenCalled();
      expect(socketMocks.groupMemberAddMode).not.toHaveBeenCalled();
      expect(socketMocks.groupJoinApprovalMode).not.toHaveBeenCalled();
      expect(socketMocks.groupToggleEphemeral).not.toHaveBeenCalled();
    });
  });

  describe("join requests - listing", () => {
    it("normalizes jid and timestamp, keeping the raw entry", async () => {
      socketMocks.groupRequestParticipantsList.mockResolvedValue([
        { jid: "6281@s.whatsapp.net", t: "1700000000", method: "invite_link" },
      ]);
      const client = makeConnectedClient();

      const requests = await client.getGroupJoinRequests(GJID);

      expect(requests).toEqual([
        {
          jid: "6281@s.whatsapp.net",
          requestedAt: 1700000000,
          raw: {
            jid: "6281@s.whatsapp.net",
            t: "1700000000",
            method: "invite_link",
          },
        },
      ]);
    });

    it("falls back to phone_number when jid is absent", async () => {
      socketMocks.groupRequestParticipantsList.mockResolvedValue([
        { phone_number: "6282@s.whatsapp.net" },
      ]);
      const client = makeConnectedClient();

      const [request] = await client.getGroupJoinRequests(GJID);

      expect(request.jid).toBe("6282@s.whatsapp.net");
      expect(request.requestedAt).toBeUndefined();
    });

    it("leaves requestedAt undefined for an unparseable timestamp", async () => {
      socketMocks.groupRequestParticipantsList.mockResolvedValue([
        { jid: "6283@s.whatsapp.net", t: "not-a-number" },
      ]);
      const client = makeConnectedClient();

      const [request] = await client.getGroupJoinRequests(GJID);

      expect(request.requestedAt).toBeUndefined();
    });

    it("returns [] when WhatsApp returns nothing at all", async () => {
      socketMocks.groupRequestParticipantsList.mockResolvedValue(undefined);
      const client = makeConnectedClient();

      await expect(client.getGroupJoinRequests(GJID)).resolves.toEqual([]);
    });

    it("reads community requests from the community socket method", async () => {
      socketMocks.communityRequestParticipantsList.mockResolvedValue([
        { jid: "6284@s.whatsapp.net" },
      ]);
      const client = makeConnectedClient();

      const requests = await client.getCommunityJoinRequests(CJID);

      expect(requests).toHaveLength(1);
      expect(socketMocks.groupRequestParticipantsList).not.toHaveBeenCalled();
    });
  });

  describe("join requests - approve/reject", () => {
    it("approve formats bare phone numbers into JIDs", async () => {
      socketMocks.groupRequestParticipantsUpdate.mockResolvedValue([
        { jid: "6281234567890@s.whatsapp.net", status: "200" },
      ]);
      const client = makeConnectedClient();

      const results = await client.approveGroupJoinRequests(GJID, [
        "6281234567890",
      ]);

      expect(socketMocks.groupRequestParticipantsUpdate).toHaveBeenCalledWith(
        GJID,
        ["6281234567890@s.whatsapp.net"],
        "approve"
      );
      expect(results).toEqual([
        { jid: "6281234567890@s.whatsapp.net", status: "200", success: true },
      ]);
    });

    it("reject sends the reject action", async () => {
      socketMocks.groupRequestParticipantsUpdate.mockResolvedValue([
        { jid: "6281234567890@s.whatsapp.net", status: "200" },
      ]);
      const client = makeConnectedClient();

      await client.rejectGroupJoinRequests(GJID, ["6281234567890"]);

      expect(socketMocks.groupRequestParticipantsUpdate).toHaveBeenCalledWith(
        GJID,
        ["6281234567890@s.whatsapp.net"],
        "reject"
      );
    });

    it("marks a non-200 status as unsuccessful without throwing", async () => {
      socketMocks.groupRequestParticipantsUpdate.mockResolvedValue([
        { jid: "6281@s.whatsapp.net", status: "403" },
      ]);
      const client = makeConnectedClient();

      const results = await client.approveGroupJoinRequests(GJID, ["6281"]);

      expect(results).toEqual([
        { jid: "6281@s.whatsapp.net", status: "403", success: false },
      ]);
    });

    it("community approve uses the community socket method", async () => {
      socketMocks.communityRequestParticipantsUpdate.mockResolvedValue([
        { jid: "6281@s.whatsapp.net", status: "200" },
      ]);
      const client = makeConnectedClient();

      await client.approveCommunityJoinRequests(CJID, ["6281"]);

      expect(socketMocks.communityRequestParticipantsUpdate).toHaveBeenCalledWith(
        CJID,
        ["6281@s.whatsapp.net"],
        "approve"
      );
      expect(socketMocks.groupRequestParticipantsUpdate).not.toHaveBeenCalled();
    });
  });

  describe("guards", () => {
    it("rejects a JID that is not a group JID", async () => {
      const client = makeConnectedClient();

      const res = await client.setGroupAnnounceOnly(
        "6281@s.whatsapp.net",
        true
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain("@g.us");
      expect(socketMocks.groupSettingUpdate).not.toHaveBeenCalled();
    });

    it("rejects a non-group JID for communities too", async () => {
      const client = makeConnectedClient();

      const res = await client.setCommunityAnnounceOnly(
        "6281@s.whatsapp.net",
        true
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain("@g.us");
    });

    it("returns an error result when not connected", async () => {
      const client = makeDisconnectedClient();

      const res = await client.setGroupAnnounceOnly(GJID, true);

      expect(res.success).toBe(false);
      expect(res.error).toContain("Not connected");
    });

    it("returns [] from a listing when not connected", async () => {
      const client = makeDisconnectedClient();

      await expect(client.getGroupJoinRequests(GJID)).resolves.toEqual([]);
    });

    it("reports every participant as failed when not connected", async () => {
      const client = makeDisconnectedClient();

      const results = await client.approveGroupJoinRequests(GJID, [
        "6281234567890",
      ]);

      expect(results).toEqual([
        {
          jid: "6281234567890@s.whatsapp.net",
          status: "error",
          success: false,
        },
      ]);
    });

    it("surfaces a socket rejection as an error result", async () => {
      socketMocks.groupSettingUpdate.mockRejectedValue(new Error("forbidden"));
      const client = makeConnectedClient();

      const res = await client.setGroupAnnounceOnly(GJID, true);

      expect(res).toEqual({ success: false, error: "forbidden" });
    });
  });
});
