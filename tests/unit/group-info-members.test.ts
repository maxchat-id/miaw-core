/**
 * Unit tests for getGroupInfo members in phone (PN) and LID groups.
 *
 * Every member gets a phone when one is known (shared by WhatsApp, cached or
 * resolved through the native store), keeps its LID, and gets a name from the
 * contact store. The group reports its addressing mode. The pairs kept for
 * tags stay within a cap on groups and on pairs across all groups.
 */

import { jest, describe, it, expect } from "@jest/globals";

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
const { CACHE_CONFIG } = await import("../../src/constants/cache.js");

const GJID = "120363000000000000@g.us";

function makeClient(metadata: any, nativePairs: { lid: string; pn: string }[] = []): any {
  const client: any = new MiawClient({ instanceId: "test-group-members" });
  jest.spyOn(client, "saveLidMappingsToFile").mockImplementation(() => {});
  jest.spyOn(client, "saveContactsToFile").mockImplementation(() => {});
  client.connectionState = "connected";
  client.socket = {
    groupMetadata: jest.fn<() => Promise<unknown>>().mockResolvedValue(metadata),
    signalRepository: {
      lidMapping: {
        getPNsForLIDs: jest.fn<() => Promise<unknown>>().mockResolvedValue(nativePairs),
      },
    },
  };
  return client;
}

describe("getGroupInfo members", () => {
  it("gives LID-group members their phone, LID and contact name", async () => {
    const client = makeClient(
      {
        id: GJID,
        subject: "Grup LID",
        addressingMode: "lid",
        participants: [
          { id: "111@lid", phoneNumber: "6281100000001@s.whatsapp.net", admin: "superadmin" },
          { id: "222@lid", admin: null },
          { id: "333@lid", admin: "admin" },
          { id: "444@lid", admin: null },
        ],
      },
      [{ lid: "333@lid", pn: "6281300000003@s.whatsapp.net" }]
    );
    client.registerLidMapping("222@lid", "6281200000002@s.whatsapp.net");
    client.updateContactsStore([
      { id: "6281200000002@s.whatsapp.net", name: "Budi" },
    ]);

    const info = await client.getGroupInfo(GJID);

    expect(info.addressingMode).toBe("lid");
    expect(info.participants).toEqual([
      {
        jid: "6281100000001@s.whatsapp.net",
        role: "superadmin",
        phone: "6281100000001",
        lid: "111@lid",
      },
      {
        jid: "6281200000002@s.whatsapp.net",
        role: "member",
        phone: "6281200000002",
        lid: "222@lid",
        name: "Budi",
      },
      {
        jid: "6281300000003@s.whatsapp.net",
        role: "admin",
        phone: "6281300000003",
        lid: "333@lid",
      },
      // Nobody knows this member's phone: keep the bare LID.
      { jid: "444@lid", role: "member", lid: "444@lid" },
    ]);
  });

  it("keeps phone-group members on their phone JID", async () => {
    const client = makeClient({
      id: GJID,
      subject: "Grup PN",
      addressingMode: "pn",
      participants: [
        { id: "6281100000001@s.whatsapp.net", lid: "111@lid", admin: null },
      ],
    });

    const info = await client.getGroupInfo(GJID);

    expect(info.addressingMode).toBe("pn");
    expect(info.participants).toEqual([
      {
        jid: "6281100000001@s.whatsapp.net",
        role: "member",
        phone: "6281100000001",
        lid: "111@lid",
      },
    ]);
  });

  it("keeps a group's pairs for its tags, away from the LID cache and its file", async () => {
    const participants = Array.from({ length: 1500 }, (_, i) => ({
      id: `${100000 + i}@lid`,
      phoneNumber: `62811${String(i).padStart(7, "0")}@s.whatsapp.net`,
      admin: null,
    }));
    const client = makeClient({ id: GJID, subject: "Besar", addressingMode: "lid", participants });
    client.registerLidMapping("999@lid", "6289999999999@s.whatsapp.net");
    client.saveLidMappingsToFile.mockClear();

    const info = await client.getGroupInfo(GJID);

    expect(info.participants).toHaveLength(1500);
    expect(info.participants[1499]).toMatchObject({ phone: "628110001499", lid: "101499@lid" });
    // The DM mapping survives and nothing is written for the group.
    expect(client.resolveLidToJid("999@lid")).toBe("6289999999999@s.whatsapp.net");
    expect(client.resolveLidToJid("101499@lid")).toBe("101499@lid");
    expect(client.saveLidMappingsToFile).not.toHaveBeenCalled();

    // A tag of a member in that group now resolves without any lookup.
    const message: any = {
      id: "T1",
      from: GJID,
      isGroup: true,
      mentions: [{ jid: "101499@lid" }],
    };
    client.fillKnownMentionPhones(message);
    expect(message.mentions).toEqual([{ jid: "101499@lid", phone: "628110001499" }]);
  });

  it("resolves hidden members through the native store without caching them", async () => {
    const client = makeClient(
      { id: GJID, subject: "Grup LID", addressingMode: "lid", participants: [{ id: "333@lid", admin: null }] },
      [{ lid: "333@lid", pn: "6281300000003@s.whatsapp.net" }]
    );

    const info = await client.getGroupInfo(GJID);

    expect(info.participants[0]).toMatchObject({ phone: "6281300000003", lid: "333@lid" });
    expect(client.resolveLidToJid("333@lid")).toBe("333@lid");
    expect(client.saveLidMappingsToFile).not.toHaveBeenCalled();
  });
});

describe("pairs kept for tags", () => {
  const pairsOf = (count: number, offset: number) =>
    new Map(Array.from({ length: count }, (_, i) => [`${offset + i}@lid`, `62811${offset + i}`]));

  it("drops the oldest groups once the pairs across groups pass the cap", () => {
    const client = makeClient({ id: GJID, participants: [] });
    const cap = CACHE_CONFIG.GROUP_MEMBERS_MAX_ENTRIES;
    const size = Math.floor(cap / 3);

    client.rememberGroupMembers("g1@g.us", pairsOf(size, 0));
    client.rememberGroupMembers("g2@g.us", pairsOf(size, 1_000_000));
    client.rememberGroupMembers("g3@g.us", pairsOf(size, 2_000_000));
    client.rememberGroupMembers("g4@g.us", pairsOf(size, 3_000_000));

    expect([...client.groupMemberPhones.keys()]).toEqual(["g2@g.us", "g3@g.us", "g4@g.us"]);
    const total = [...client.groupMemberPhones.values()].reduce((sum: number, m: Map<string, string>) => sum + m.size, 0);
    expect(total).toBeLessThanOrEqual(cap);
  });

  it("keeps the group just stored even when it alone passes the cap", () => {
    const client = makeClient({ id: GJID, participants: [] });
    client.rememberGroupMembers("small@g.us", pairsOf(10, 0));
    client.rememberGroupMembers("huge@g.us", pairsOf(CACHE_CONFIG.GROUP_MEMBERS_MAX_ENTRIES + 1, 1_000_000));

    expect([...client.groupMemberPhones.keys()]).toEqual(["huge@g.us"]);
  });

  it("still caps the number of groups", () => {
    const client = makeClient({ id: GJID, participants: [] });
    for (let i = 0; i <= CACHE_CONFIG.GROUP_MEMBERS_MAX_GROUPS; i++) {
      client.rememberGroupMembers(`g${i}@g.us`, pairsOf(1, i));
    }

    expect(client.groupMemberPhones.size).toBe(CACHE_CONFIG.GROUP_MEMBERS_MAX_GROUPS);
    expect(client.groupMemberPhones.has("g0@g.us")).toBe(false);
  });
});
