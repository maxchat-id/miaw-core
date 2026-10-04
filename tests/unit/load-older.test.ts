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
 *  - A timeout is reported as `timedOut: true`.
 *  - A history answer writes the store to disk once, not once per message.
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

const PN = "6281111111111@s.whatsapp.net";
const LID = "123456789012345@lid";
const GROUP = "120363000000000000@g.us";
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
  timeoutMs = 1000
): Promise<{ pending: Promise<any> }> {
  // Wrapped: an async function would otherwise flatten (await) the returned promise.
  const pending = ctx.client.loadMoreMessages(jid, 50, timeoutMs);
  while (!ctx.client.pendingHistoryRequests.has(SESSION)) {
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

  it("leaves other chats in the same answer on the normal path", async () => {
    const ctx = makeClient();
    seedAnchor(ctx.client, PN, LID);
    const OTHER_LID = "999999999999999@lid";

    const { pending } = await startLoad(ctx, PN);
    ctx.emitHistory([...older(1, LID), textMsg("X1", OTHER_LID, 500)], SESSION);

    await expect(pending).resolves.toEqual({ success: true, messagesLoaded: 1, hasMore: true });
    expect(ctx.client.messagesStore.get(OTHER_LID)).toHaveLength(1);
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

  it("still writes once per live message", async () => {
    const ctx = makeClient();
    await ctx.emitUpsert(textMsg("L1", PN, 3000));
    await ctx.emitUpsert(textMsg("L2", PN, 3001));

    expect(ctx.save).toHaveBeenCalledTimes(2);
  });
});
