/**
 * Unit tests for loadMoreMessages + the on-demand history answer.
 *
 * Regression coverage for "Load Older returns messagesLoaded: 0 on 1:1 chats":
 *  - WhatsApp answers an on-demand history request for a chat whose anchor
 *    key is @lid with messages keyed by that @lid. Without a cached LID->PN
 *    mapping they used to land in the @lid bucket, so the PN chat the caller
 *    asked about gained nothing. They must land in the requested chat.
 *  - messagesLoaded counts the messages newly stored for that chat.
 *  - hasMore is false only when WhatsApp answers with no message for the chat.
 *  - A timeout is reported as `timedOut: true`; an answer that arrives after it
 *    still lands in the requested chat, since WhatsApp does not send it twice.
 *  - Every 1:1 message of an on-demand answer belongs to the requested chat:
 *    WhatsApp keys the answer by how the phone stores the chat, not by the
 *    remoteJid of the anchor it was asked with.
 *  - An explicit anchor starts the request from a message the caller names,
 *    whether or not the store holds it.
 *  - A history answer writes the store to disk once, not once per message.
 *
 * A fake socket is injected; no real WhatsApp connection.
 */

import { jest, describe, beforeEach, afterEach, it, expect } from "@jest/globals";
import { TIMEOUTS } from "../../src/constants/timeouts.js";

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

const PN = "6281111111111@s.whatsapp.net";
const LID = "123456789012345@lid";
const GROUP = "120363000000000000@g.us";
const OTHER_PN = "6282222222222@s.whatsapp.net";
const OTHER_LID = "999999999999999@lid";
const SESSION = "session-1";

/** Build a synthetic Baileys text message. */
function textMsg(id: string, remoteJid: string, ts: number, extra: any = {}): any {
  return {
    key: { id, remoteJid, fromMe: false, ...extra },
    message: { conversation: `text ${id}` },
    pushName: "Sender",
    messageTimestamp: ts,
  };
}

function placeholderMsg(id: string, remoteJid: string, ts: number): any {
  return {
    key: { id, remoteJid, fromMe: false },
    messageStubType: 75,
    messageTimestamp: ts,
  };
}

function makeClient(): {
  client: any;
  save: jest.Mock;
  fetchMessageHistory: jest.Mock;
  emitHistory: (messages: any[], peerDataRequestSessionId?: string) => void;
  emitUpsert: (...messages: any[]) => Promise<void>;
} {
  const client: any = new MiawClient({ instanceId: "test-load-older" });
  const save = jest.spyOn(client, "saveMessagesToFile").mockImplementation(() => {}) as unknown as jest.Mock;
  jest.spyOn(client, "saveLidMappingsToFile").mockImplementation(() => {});
  jest.spyOn(client, "saveChatsToFile").mockImplementation(() => {});
  jest.spyOn(client, "saveContactsToFile").mockImplementation(() => {});
  client.messagesStore.clear();

  const handlers: Record<string, (arg: any) => any> = {};
  const fetchMessageHistory = jest.fn<() => Promise<string>>().mockResolvedValue(SESSION);
  client.socket = {
    ev: {
      on: (event: string, handler: (arg: any) => any) => {
        handlers[event] = handler;
      },
    },
    fetchMessageHistory,
  };
  client.registerSocketEvents(async () => {});
  client.connectionState = "connected";

  return {
    client,
    save,
    fetchMessageHistory: fetchMessageHistory as unknown as jest.Mock,
    emitHistory: (messages, peerDataRequestSessionId) =>
      handlers["messaging-history.set"]({
        chats: [],
        contacts: [],
        messages,
        isLatest: false,
        peerDataRequestSessionId,
      }),
    emitUpsert: (...messages) => handlers["messages.upsert"]({ type: "notify", messages }),
  };
}

/** Seed one message in `chatJid` whose raw key uses `anchorJid` (as stored after a live message). */
function seedAnchor(client: any, chatJid: string, anchorJid: string): void {
  const raw = textMsg("ANCHOR", anchorJid, 2000);
  client.storeMessage({
    id: "ANCHOR",
    from: chatJid,
    fromMe: false,
    type: "text",
    text: "anchor",
    timestamp: 2000,
    isGroup: chatJid.endsWith("@g.us"),
    raw,
  });
}

/** Start loadMoreMessages and wait until the history request is registered. */
async function startLoad(
  ctx: ReturnType<typeof makeClient>,
  jid: string,
  timeoutMs = 1000,
  anchor?: { id: string; fromMe: boolean; timestamp: number }
): Promise<{ pending: Promise<any> }> {
  // Wrapped: an async function would otherwise flatten (await) the returned promise.
  const pending = ctx.client.loadMoreMessages(jid, 50, timeoutMs, anchor);
  // A load that fails before asking WhatsApp never registers; do not wait for it.
  let settled = false;
  void pending.then(() => (settled = true));
  while (!settled && !ctx.client.pendingHistoryRequests.has(SESSION)) {
    await new Promise((r) => setImmediate(r));
  }
  return { pending };
}

function older(n: number, remoteJid: string, prefix = "OLD"): any[] {
  return Array.from({ length: n }, (_, i) => textMsg(`${prefix}${i}`, remoteJid, 1000 - i));
}

describe("loadMoreMessages on-demand answer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("stores an @lid answer for an @lid anchor in the requested PN chat", async () => {
    const ctx = makeClient();
    seedAnchor(ctx.client, PN, LID);

    const { pending } = await startLoad(ctx, PN);
    expect(ctx.fetchMessageHistory).toHaveBeenCalledWith(50, expect.objectContaining({ remoteJid: LID }), 2000 * 1000);
    ctx.emitHistory(older(3, LID), SESSION);

    await expect(pending).resolves.toEqual({ success: true, messagesLoaded: 3, hasMore: true });
    expect(ctx.client.messagesStore.get(PN)).toHaveLength(4);
    expect(ctx.client.messagesStore.has(LID)).toBe(false);
    const res = await ctx.client.getChatMessages(PN);
    expect(res.messages.map((m: any) => m.id)).toEqual(expect.arrayContaining(["OLD0", "OLD1", "OLD2"]));
  });

  it("stores a group answer in the group chat", async () => {
    const ctx = makeClient();
    seedAnchor(ctx.client, GROUP, GROUP);

    const { pending } = await startLoad(ctx, GROUP);
    ctx.emitHistory(older(2, GROUP, "G").map((m) => ({ ...m, key: { ...m.key, participant: PN } })), SESSION);

    await expect(pending).resolves.toEqual({ success: true, messagesLoaded: 2, hasMore: true });
    expect(ctx.client.messagesStore.get(GROUP)).toHaveLength(3);
  });

  it.each([
    [50, true],
    [49, true],
    [0, false],
  ])("answer with %i messages -> hasMore %s", async (n, hasMore) => {
    const ctx = makeClient();
    seedAnchor(ctx.client, PN, LID);

    const { pending } = await startLoad(ctx, PN);
    ctx.emitHistory(older(n, LID), SESSION);

    await expect(pending).resolves.toEqual({ success: true, messagesLoaded: n, hasMore });
  });

  it("does not count messages already in the chat", async () => {
    const ctx = makeClient();
    seedAnchor(ctx.client, PN, LID);

    const { pending } = await startLoad(ctx, PN);
    ctx.emitHistory([textMsg("ANCHOR", LID, 2000), ...older(2, LID)], SESSION);

    await expect(pending).resolves.toEqual({ success: true, messagesLoaded: 2, hasMore: true });
    expect(ctx.client.messagesStore.get(PN)).toHaveLength(3);
  });

  it("does not count a hidden placeholder as a loaded public message", async () => {
    const ctx = makeClient();
    seedAnchor(ctx.client, PN, LID);

    const { pending } = await startLoad(ctx, PN);
    ctx.emitHistory([placeholderMsg("STUB", LID, 1000)], SESSION);

    await expect(pending).resolves.toEqual({
      success: true,
      messagesLoaded: 0,
      hasMore: true,
    });
    expect(ctx.client.messagesStore.get(PN)).toHaveLength(2);
    expect((await ctx.client.getChatMessages(PN)).messages).toHaveLength(1);
  });

  it("counts a same-answer placeholder upgrade once", async () => {
    const ctx = makeClient();
    seedAnchor(ctx.client, PN, LID);

    const { pending } = await startLoad(ctx, PN);
    ctx.emitHistory([
      placeholderMsg("UPGRADE", LID, 1000),
      textMsg("UPGRADE", LID, 1000),
    ], SESSION);

    await expect(pending).resolves.toEqual({
      success: true,
      messagesLoaded: 1,
      hasMore: true,
    });
    expect(ctx.client.messagesStore.get(PN)).toHaveLength(2);
    expect((await ctx.client.getChatMessages(PN)).messages).toHaveLength(2);
  });

  it("stores an @lid answer for a PN anchor in the requested PN chat", async () => {
    const ctx = makeClient();
    seedAnchor(ctx.client, PN, PN);

    const { pending } = await startLoad(ctx, PN);
    ctx.emitHistory(older(3, LID), SESSION);

    await expect(pending).resolves.toEqual({ success: true, messagesLoaded: 3, hasMore: true });
    expect(ctx.client.messagesStore.get(PN)).toHaveLength(4);
    expect(ctx.client.messagesStore.has(LID)).toBe(false);
  });

  it("stores a PN answer for an @lid anchor in the requested PN chat", async () => {
    const ctx = makeClient();
    seedAnchor(ctx.client, PN, LID);

    const { pending } = await startLoad(ctx, PN);
    ctx.emitHistory(older(2, PN), SESSION);

    await expect(pending).resolves.toEqual({ success: true, messagesLoaded: 2, hasMore: true });
    expect(ctx.client.messagesStore.get(PN)).toHaveLength(3);
  });

  it("leaves a message of another phone number in a 1:1 answer on the normal path", async () => {
    const ctx = makeClient();
    seedAnchor(ctx.client, PN, LID);

    const { pending } = await startLoad(ctx, PN);
    ctx.emitHistory([...older(1, LID), textMsg("X1", OTHER_PN, 500)], SESSION);

    await expect(pending).resolves.toEqual({ success: true, messagesLoaded: 1, hasMore: true });
    expect(ctx.client.messagesStore.get(OTHER_PN)).toHaveLength(1);
    expect(ctx.client.messagesStore.get(PN)).toHaveLength(2);
  });

  it("leaves a message of an @lid known as another chat on the normal path", async () => {
    const ctx = makeClient();
    seedAnchor(ctx.client, PN, LID);
    ctx.client.captureLidPnPair(OTHER_LID, OTHER_PN);

    const { pending } = await startLoad(ctx, PN);
    ctx.emitHistory([...older(1, LID), textMsg("X1", OTHER_LID, 500)], SESSION);

    await expect(pending).resolves.toEqual({ success: true, messagesLoaded: 1, hasMore: true });
    expect(ctx.client.messagesStore.get(OTHER_PN)).toHaveLength(1);
    expect(ctx.client.messagesStore.get(PN)).toHaveLength(2);
  });

  it("leaves a group message in a 1:1 answer on the normal path", async () => {
    const ctx = makeClient();
    seedAnchor(ctx.client, PN, LID);

    const { pending } = await startLoad(ctx, PN);
    ctx.emitHistory([...older(1, LID), textMsg("X1", GROUP, 500, { participant: PN })], SESSION);

    await expect(pending).resolves.toEqual({ success: true, messagesLoaded: 1, hasMore: true });
    expect(ctx.client.messagesStore.get(GROUP)).toHaveLength(1);
    expect(ctx.client.messagesStore.get(PN)).toHaveLength(2);
  });

  it("leaves a 1:1 message in a group answer on the normal path", async () => {
    const ctx = makeClient();
    seedAnchor(ctx.client, GROUP, GROUP);

    const { pending } = await startLoad(ctx, GROUP);
    ctx.emitHistory([...older(1, GROUP, "G"), textMsg("X1", LID, 500)], SESSION);

    await expect(pending).resolves.toEqual({ success: true, messagesLoaded: 1, hasMore: true });
    expect(ctx.client.messagesStore.get(LID)).toHaveLength(1);
    expect(ctx.client.messagesStore.get(GROUP)).toHaveLength(2);
  });

  it("reports a timeout with timedOut: true", async () => {
    const ctx = makeClient();
    seedAnchor(ctx.client, PN, LID);

    const { pending } = await startLoad(ctx, PN, 5);

    await expect(pending).resolves.toEqual({
      success: false,
      error: "Timeout waiting for history (5ms)",
      timedOut: true,
    });
  });

  it("stores an answer that arrives after the timeout in the requested chat", async () => {
    const ctx = makeClient();
    seedAnchor(ctx.client, PN, LID);

    const { pending } = await startLoad(ctx, PN, 5);
    await pending;
    ctx.emitHistory(older(2, LID), SESSION);

    expect(ctx.client.messagesStore.get(PN)).toHaveLength(3);
    expect(ctx.client.messagesStore.has(LID)).toBe(false);
    expect(ctx.client.pendingHistoryRequests.size).toBe(0);
  });

  it.each([
    ["not connected", (c: any) => (c.connectionState = "disconnected")],
    ["empty store", (c: any) => c.messagesStore.clear()],
    ["no raw message", (c: any) => delete c.messagesStore.get(PN)[0].raw],
  ])("fails without a history request when %s", async (_label, breakIt) => {
    const ctx = makeClient();
    seedAnchor(ctx.client, PN, LID);
    breakIt(ctx.client);

    const res = await ctx.client.loadMoreMessages(PN);

    expect(res.success).toBe(false);
    expect(res.timedOut).toBeUndefined();
    expect(ctx.fetchMessageHistory).not.toHaveBeenCalled();
  });
});

describe("late answer window", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("forgets a timed out request once the window is over", async () => {
    jest.useFakeTimers({ doNotFake: ["setImmediate"] });
    const ctx = makeClient();
    seedAnchor(ctx.client, PN, LID);

    const { pending } = await startLoad(ctx, PN, 1000);
    jest.advanceTimersByTime(1000);
    await expect(pending).resolves.toMatchObject({ timedOut: true });
    expect(ctx.client.pendingHistoryRequests.size).toBe(1);

    jest.advanceTimersByTime(TIMEOUTS.HISTORY_LATE_ANSWER);
    expect(ctx.client.pendingHistoryRequests.size).toBe(0);

    ctx.emitHistory(older(1, LID), SESSION);
    expect(ctx.client.messagesStore.get(LID)).toHaveLength(1);
  });
});

describe("loadMoreMessages with an explicit anchor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /** Store `id` in `chatJid` with a raw key on `keyJid`. */
  function seed(client: any, chatJid: string, keyJid: string, id: string, ts: number, fromMe = false): any {
    const raw = textMsg(id, keyJid, ts, { fromMe, participant: "" });
    client.storeMessage({ id, from: chatJid, fromMe, type: "text", text: id, timestamp: ts, isGroup: false, raw });
    return raw;
  }

  it("starts from the named message of the chat, not from its oldest one", async () => {
    const ctx = makeClient();
    seed(ctx.client, PN, PN, "OLDEST", 1000);
    const named = seed(ctx.client, PN, LID, "NAMED", 3000, true);

    const { pending } = await startLoad(ctx, PN, 1000, { id: "NAMED", fromMe: true, timestamp: 3060 });
    expect(ctx.fetchMessageHistory).toHaveBeenCalledWith(50, named.key, 3000 * 1000);
    ctx.emitHistory(older(2, LID), SESSION);

    await expect(pending).resolves.toEqual({ success: true, messagesLoaded: 2, hasMore: true });
  });

  it("finds the named message in another bucket when the chat's own is empty", async () => {
    const ctx = makeClient();
    const named = seed(ctx.client, LID, LID, "NAMED", 3000);

    const { pending } = await startLoad(ctx, PN, 1000, { id: "NAMED", fromMe: false, timestamp: 3000 });
    expect(ctx.fetchMessageHistory).toHaveBeenCalledWith(50, named.key, 3000 * 1000);
    ctx.emitHistory(older(2, LID), SESSION);

    await expect(pending).resolves.toEqual({ success: true, messagesLoaded: 2, hasMore: true });
    expect(ctx.client.messagesStore.get(PN)).toHaveLength(2);
  });

  it("does not take a message with the same id but the other fromMe", async () => {
    const ctx = makeClient();
    seed(ctx.client, PN, LID, "NAMED", 3000, false);

    await startLoad(ctx, PN, 1000, { id: "NAMED", fromMe: true, timestamp: 3000 });

    expect(ctx.fetchMessageHistory).toHaveBeenCalledWith(50, { remoteJid: PN, id: "NAMED", fromMe: true }, 3000 * 1000);
  });

  it.each([
    ["another phone number", OTHER_PN, OTHER_PN],
    ["a group", GROUP, GROUP],
  ])("does not take the named message from the bucket of %s", async (_label, bucket, keyJid) => {
    const ctx = makeClient();
    seed(ctx.client, bucket, keyJid, "NAMED", 3000);

    await startLoad(ctx, PN, 1000, { id: "NAMED", fromMe: false, timestamp: 3000 });

    expect(ctx.fetchMessageHistory).toHaveBeenCalledWith(50, { remoteJid: PN, id: "NAMED", fromMe: false }, 3000 * 1000);
  });

  it("does not take the named message from an @lid known as another chat", async () => {
    const ctx = makeClient();
    ctx.client.captureLidPnPair(OTHER_LID, OTHER_PN);
    seed(ctx.client, OTHER_LID, OTHER_LID, "NAMED", 3000);

    await startLoad(ctx, PN, 1000, { id: "NAMED", fromMe: false, timestamp: 3000 });

    expect(ctx.fetchMessageHistory).toHaveBeenCalledWith(50, { remoteJid: PN, id: "NAMED", fromMe: false }, 3000 * 1000);
  });

  it("uses the anchor's timestamp when the stored one is not a number", async () => {
    const ctx = makeClient();
    const named = seed(ctx.client, PN, LID, "NAMED", 3000);
    // A Long, as it comes back from the store file.
    named.messageTimestamp = { low: 3000, high: 0, unsigned: true };

    await startLoad(ctx, PN, 1000, { id: "NAMED", fromMe: false, timestamp: 3060 });

    expect(ctx.fetchMessageHistory).toHaveBeenCalledWith(50, named.key, 3060 * 1000);
  });

  it("asks with the chat's own jid when the store does not hold the named message", async () => {
    const ctx = makeClient();
    seed(ctx.client, PN, PN, "NEWER", 5000);

    const { pending } = await startLoad(ctx, PN, 1000, { id: "GONE", fromMe: false, timestamp: 4000 });
    expect(ctx.fetchMessageHistory).toHaveBeenCalledWith(50, { remoteJid: PN, id: "GONE", fromMe: false }, 4000 * 1000);
    ctx.emitHistory(older(3, LID), SESSION);

    await expect(pending).resolves.toEqual({ success: true, messagesLoaded: 3, hasMore: true });
    expect(ctx.client.messagesStore.get(PN)).toHaveLength(4);
  });

  it("loads a chat whose bucket is empty", async () => {
    const ctx = makeClient();

    const { pending } = await startLoad(ctx, PN, 1000, { id: "GONE", fromMe: true, timestamp: 4000 });
    expect(ctx.fetchMessageHistory).toHaveBeenCalledWith(50, { remoteJid: PN, id: "GONE", fromMe: true }, 4000 * 1000);
    ctx.emitHistory(older(2, LID), SESSION);

    await expect(pending).resolves.toEqual({ success: true, messagesLoaded: 2, hasMore: true });
    expect(ctx.client.messagesStore.get(PN)).toHaveLength(2);
  });

  it("still fails on an empty bucket without an anchor", async () => {
    const ctx = makeClient();

    const res = await ctx.client.loadMoreMessages(PN);

    expect(res).toEqual({
      success: false,
      error: "No messages in store to paginate from. Send or receive a message first.",
    });
    expect(ctx.fetchMessageHistory).not.toHaveBeenCalled();
  });
});

describe("history answer without a pending request", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("keeps an unresolved @lid message in its @lid bucket (initial sync)", () => {
    const ctx = makeClient();
    ctx.emitHistory(older(2, LID));

    expect(ctx.client.messagesStore.get(LID)).toHaveLength(2);
    expect(ctx.client.messagesStore.has(PN)).toBe(false);
  });

  it("keeps a late answer (session no longer pending) on the normal path", () => {
    const ctx = makeClient();
    ctx.emitHistory(older(1, LID), "expired-session");

    expect(ctx.client.messagesStore.get(LID)).toHaveLength(1);
  });
});

describe("store writes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("writes the store once per history event", () => {
    const ctx = makeClient();
    ctx.emitHistory(older(5, PN));

    expect(ctx.client.messagesStore.get(PN)).toHaveLength(5);
    expect(ctx.save).toHaveBeenCalledTimes(1);
  });

  it("does not write when the history event brings nothing new", () => {
    const ctx = makeClient();
    ctx.emitHistory(older(3, PN));
    ctx.save.mockClear();

    ctx.emitHistory(older(3, PN));
    ctx.emitHistory([]);

    expect(ctx.save).not.toHaveBeenCalled();
  });

  it("writes once for an on-demand answer", async () => {
    const ctx = makeClient();
    seedAnchor(ctx.client, PN, LID);
    ctx.save.mockClear();

    const { pending } = await startLoad(ctx, PN);
    ctx.emitHistory(older(4, LID), SESSION);
    await pending;

    expect(ctx.save).toHaveBeenCalledTimes(1);
  });

  it("routes each changed live message through the scheduler", async () => {
    const ctx = makeClient();
    await ctx.emitUpsert(textMsg("L1", PN, 3000));
    await ctx.emitUpsert(textMsg("L2", PN, 3001));

    expect(ctx.save).toHaveBeenCalledTimes(2);
  });
});
