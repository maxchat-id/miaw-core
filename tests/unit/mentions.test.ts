/**
 * Unit tests for tagged people (@mentions) on live messages.
 *
 * - Tags with a phone JID keep their phone.
 * - LID tags are resolved to a phone: local cache first, then one batched
 *   native-store lookup.
 * - A LID that cannot be resolved stays as a bare LID and is logged with ids
 *   only (no text, no phone).
 * - History and Load Older messages get the same native-store lookup, batched
 *   once per history answer, before the store is saved or Load Older answers.
 * - Live messages are emitted in arrival order while a lookup awaits.
 *
 * A fake socket is injected; no real WhatsApp connection.
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
const { TIMEOUTS } = await import("../../src/constants/timeouts.js");

const GROUP = "120363000000000000@g.us";
const SENDER = "6281200000002@s.whatsapp.net";
const PN = "6281100000001@s.whatsapp.net";
const CACHED_LID = "111111111111111@lid";
const STORE_LID = "222222222222222@lid";
const UNKNOWN_LID = "333333333333333@lid";

function makeClient(getPNsForLIDs: jest.Mock) {
  const logger: any = {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    fatal: jest.fn(),
    trace: jest.fn(),
    level: "silent",
  };
  logger.child = () => logger;

  const client: any = new MiawClient({ instanceId: "test-mentions", logger });
  jest.spyOn(client, "saveMessagesToFile").mockImplementation(() => {});
  jest.spyOn(client, "saveLidMappingsToFile").mockImplementation(() => {});
  jest.spyOn(client, "saveChatsToFile").mockImplementation(() => {});
  jest.spyOn(client, "saveContactsToFile").mockImplementation(() => {});
  client.messagesStore.clear();

  const handlers: Record<string, (arg: any) => any> = {};
  client.socket = {
    ev: {
      on: (event: string, handler: (arg: any) => any) => {
        handlers[event] = handler;
      },
    },
    signalRepository: { lidMapping: { getPNsForLIDs } },
  };
  client.registerSocketEvents(async () => {});
  client.connectionState = "connected";

  const received: any[] = [];
  client.on("message", (message: any) => received.push(message));

  return {
    client,
    logger,
    received,
    emitUpsert: (...messages: any[]) =>
      handlers["messages.upsert"]({ type: "notify", messages }),
    emitHistory: (messages: any[], peerDataRequestSessionId?: string) =>
      handlers["messaging-history.set"]({
        chats: [],
        contacts: [],
        messages,
        isLatest: false,
        peerDataRequestSessionId,
      }),
  };
}

function taggedGroupMsg(id: string, mentionedJid: string[]): any {
  return {
    key: { id, remoteJid: GROUP, participant: SENDER, fromMe: false },
    pushName: "Budi",
    message: {
      extendedTextMessage: { text: "tolong cek ya", contextInfo: { mentionedJid } },
    },
    messageTimestamp: 1700000000,
  };
}

describe("tagged people on live messages", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resolves LID tags from the cache and the native store in one batch", async () => {
    const getPNsForLIDs = jest
      .fn<(lids: string[]) => Promise<{ lid: string; pn: string }[]>>()
      .mockResolvedValue([{ lid: STORE_LID, pn: "6281300000003@s.whatsapp.net" }]);
    const ctx = makeClient(getPNsForLIDs as unknown as jest.Mock);
    ctx.client.registerLidMapping(CACHED_LID, "6281400000004@s.whatsapp.net");

    await ctx.emitUpsert(taggedGroupMsg("T1", [PN, CACHED_LID, STORE_LID]));

    expect(ctx.received).toHaveLength(1);
    expect(ctx.received[0].mentions).toEqual([
      { jid: PN, phone: "6281100000001" },
      { jid: CACHED_LID, phone: "6281400000004" },
      { jid: STORE_LID, phone: "6281300000003" },
    ]);
    // Only the cache miss goes to the native store.
    expect(getPNsForLIDs).toHaveBeenCalledTimes(1);
    expect(getPNsForLIDs).toHaveBeenCalledWith([STORE_LID]);
    expect(ctx.logger.warn).not.toHaveBeenCalled();
  });

  it("keeps an unresolved LID tag and logs ids only", async () => {
    const getPNsForLIDs = jest
      .fn<(lids: string[]) => Promise<{ lid: string; pn: string }[]>>()
      .mockResolvedValue([]);
    const ctx = makeClient(getPNsForLIDs as unknown as jest.Mock);

    await ctx.emitUpsert(taggedGroupMsg("T2", [UNKNOWN_LID]));

    expect(ctx.received[0].mentions).toEqual([{ jid: UNKNOWN_LID }]);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      "[LID] 1 tagged LID(s) unresolved (instance test-mentions, msg T2)"
    );
  });

  it("logs an unresolved LID once per window, and saves native hits in one write", async () => {
    const getPNsForLIDs = jest
      .fn<(lids: string[]) => Promise<{ lid: string; pn: string }[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { lid: STORE_LID, pn: "6281300000003@s.whatsapp.net" },
        { lid: "444444444444444@lid", pn: "6281400000004@s.whatsapp.net" },
      ]);
    const ctx = makeClient(getPNsForLIDs as unknown as jest.Mock);
    ctx.client.saveLidMappingsToFile.mockClear();

    await ctx.emitUpsert(taggedGroupMsg("W1", [UNKNOWN_LID]));
    await ctx.emitUpsert(taggedGroupMsg("W2", [UNKNOWN_LID]));
    await ctx.emitUpsert(taggedGroupMsg("W3", [STORE_LID, "444444444444444@lid"]));

    expect(ctx.logger.warn).toHaveBeenCalledTimes(1);
    expect(ctx.client.saveLidMappingsToFile).toHaveBeenCalledTimes(1);
    expect(ctx.received[2].mentions.map((m: any) => m.phone)).toEqual([
      "6281300000003",
      "6281400000004",
    ]);
  });

  it("does not log the recipient of an own message as an unresolved sender", async () => {
    const ctx = makeClient(jest.fn<() => Promise<unknown>>().mockResolvedValue([]) as unknown as jest.Mock);
    ctx.client.socket.signalRepository.lidMapping.getPNForLID = jest
      .fn<() => Promise<null>>()
      .mockResolvedValue(null);

    await ctx.emitUpsert({
      key: { id: "OWN1", remoteJid: UNKNOWN_LID, fromMe: true },
      message: { conversation: "dari hp" },
      messageTimestamp: 1700000000,
    });
    await ctx.emitUpsert({
      key: { id: "IN1", remoteJid: UNKNOWN_LID, fromMe: false },
      message: { conversation: "halo" },
      messageTimestamp: 1700000001,
    });

    expect(ctx.logger.warn).toHaveBeenCalledTimes(1);
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining("msg IN1, dm"));
  });

  it("does not look anything up when nobody is tagged", async () => {
    const getPNsForLIDs = jest.fn();
    const ctx = makeClient(getPNsForLIDs);

    await ctx.emitUpsert(taggedGroupMsg("T3", []));

    expect(ctx.received[0].mentions).toBeUndefined();
    expect(getPNsForLIDs).not.toHaveBeenCalled();
  });
});

describe("arrival order of live messages", () => {
  const plainGroupMsg = (id: string): any => ({
    key: { id, remoteJid: GROUP, participant: SENDER, fromMe: false },
    message: { conversation: "ya" },
    messageTimestamp: 1700000001,
  });

  it("emits a later message after an earlier one that waits on a LID lookup", async () => {
    let answer!: (pairs: { lid: string; pn: string }[]) => void;
    const getPNsForLIDs = jest
      .fn<(lids: string[]) => Promise<{ lid: string; pn: string }[]>>()
      .mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const ctx = makeClient(getPNsForLIDs as unknown as jest.Mock);

    const first = ctx.emitUpsert(taggedGroupMsg("A1", [STORE_LID]));
    const second = ctx.emitUpsert(plainGroupMsg("B1"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ctx.received).toHaveLength(0);

    answer([{ lid: STORE_LID, pn: "6281300000003@s.whatsapp.net" }]);
    await Promise.all([first, second]);

    expect(ctx.received.map((m: any) => m.id)).toEqual(["A1", "B1"]);
    expect(ctx.received[0].mentions).toEqual([{ jid: STORE_LID, phone: "6281300000003" }]);
  });

  it("does not let a stuck lookup hold later messages forever", async () => {
    const timeouts = TIMEOUTS as { MESSAGE_UPSERT_ORDER_WAIT: number };
    const original = timeouts.MESSAGE_UPSERT_ORDER_WAIT;
    timeouts.MESSAGE_UPSERT_ORDER_WAIT = 30;
    try {
      const getPNsForLIDs = jest
        .fn<(lids: string[]) => Promise<{ lid: string; pn: string }[]>>()
        .mockReturnValue(new Promise(() => {}));
      const ctx = makeClient(getPNsForLIDs as unknown as jest.Mock);

      void ctx.emitUpsert(taggedGroupMsg("STUCK", [STORE_LID]));
      await ctx.emitUpsert(plainGroupMsg("B2"));

      expect(ctx.received.map((m: any) => m.id)).toEqual(["B2"]);
    } finally {
      timeouts.MESSAGE_UPSERT_ORDER_WAIT = original;
    }
  });
});

describe("tagged people on history messages", () => {
  const storedMentions = (client: any, id: string) =>
    client.messagesStore.get(GROUP).find((message: any) => message.id === id).mentions;

  it("resolves history tags with one native lookup and saves once", async () => {
    const getPNsForLIDs = jest
      .fn<(lids: string[]) => Promise<{ lid: string; pn: string }[]>>()
      .mockResolvedValue([{ lid: STORE_LID, pn: "6281300000003@s.whatsapp.net" }]);
    const ctx = makeClient(getPNsForLIDs as unknown as jest.Mock);
    ctx.client.registerLidMapping(CACHED_LID, "6281400000004@s.whatsapp.net");
    ctx.client.saveMessagesToFile.mockClear();

    ctx.emitHistory([
      taggedGroupMsg("H1", [CACHED_LID, STORE_LID]),
      taggedGroupMsg("H2", [STORE_LID, UNKNOWN_LID]),
    ]);
    await Promise.all([...ctx.client.activeMessageUpserts]);

    expect(getPNsForLIDs).toHaveBeenCalledTimes(1);
    expect(getPNsForLIDs).toHaveBeenCalledWith([STORE_LID, UNKNOWN_LID]);
    expect(storedMentions(ctx.client, "H1")).toEqual([
      { jid: CACHED_LID, phone: "6281400000004" },
      { jid: STORE_LID, phone: "6281300000003" },
    ]);
    expect(storedMentions(ctx.client, "H2")).toEqual([
      { jid: STORE_LID, phone: "6281300000003" },
      { jid: UNKNOWN_LID },
    ]);
    expect(ctx.client.saveMessagesToFile).toHaveBeenCalledTimes(1);
    // History tags are not learned into the bounded LID cache.
    expect(ctx.client.resolveLidToJid(STORE_LID)).toBe(STORE_LID);
  });

  it("answers a waiting Load Older only after its tags are resolved", async () => {
    let answer!: (pairs: { lid: string; pn: string }[]) => void;
    const getPNsForLIDs = jest
      .fn<(lids: string[]) => Promise<{ lid: string; pn: string }[]>>()
      .mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const ctx = makeClient(getPNsForLIDs as unknown as jest.Mock);
    const seenAtAnswer: any[] = [];
    const resolve = jest.fn(() => {
      seenAtAnswer.push(storedMentions(ctx.client, "L1"));
    });
    ctx.client.pendingHistoryRequests.set("S1", { jid: GROUP, resolve });

    ctx.emitHistory([taggedGroupMsg("L1", [STORE_LID])], "S1");
    expect(resolve).not.toHaveBeenCalled();

    answer([{ lid: STORE_LID, pn: "6281300000003@s.whatsapp.net" }]);
    await Promise.all([...ctx.client.activeMessageUpserts]);

    expect(resolve).toHaveBeenCalledWith({ success: true, messagesLoaded: 1, hasMore: true });
    expect(seenAtAnswer).toEqual([[{ jid: STORE_LID, phone: "6281300000003" }]]);
    expect(ctx.client.pendingHistoryRequests.has("S1")).toBe(false);
  });

  it("still answers Load Older when the lookup fails", async () => {
    const getPNsForLIDs = jest
      .fn<(lids: string[]) => Promise<{ lid: string; pn: string }[]>>()
      .mockRejectedValue(new Error("store down"));
    const ctx = makeClient(getPNsForLIDs as unknown as jest.Mock);
    const resolve = jest.fn();
    ctx.client.pendingHistoryRequests.set("S2", { jid: GROUP, resolve });

    ctx.emitHistory([taggedGroupMsg("L2", [STORE_LID])], "S2");
    await Promise.all([...ctx.client.activeMessageUpserts]);

    expect(resolve).toHaveBeenCalledWith({ success: true, messagesLoaded: 1, hasMore: true });
    expect(storedMentions(ctx.client, "L2")).toEqual([{ jid: STORE_LID }]);
  });
});
