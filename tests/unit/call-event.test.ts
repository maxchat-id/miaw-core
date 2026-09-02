/**
 * Unit tests for v1.12.0 calls: the `call` event, rejectCall, createCallLink.
 *
 * Fake socket with an ev.on capture; no real connection.
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

const CALLER = "6281234567890@s.whatsapp.net";

const rejectCallMock = jest.fn<(...a: unknown[]) => Promise<unknown>>();
const createCallLinkMock = jest.fn<(...a: unknown[]) => Promise<unknown>>();

function makeConnectedClient(): any {
  const client: any = new MiawClient({ instanceId: "test-call" });
  client.connectionState = "connected";
  client.socket = {
    rejectCall: rejectCallMock,
    createCallLink: createCallLinkMock,
  };
  return client;
}

describe("v1.12.0 calls", () => {
  beforeEach(() => {
    rejectCallMock.mockReset().mockResolvedValue(undefined);
    createCallLinkMock.mockReset().mockResolvedValue(undefined);
  });

  describe("call event normalization", () => {
    function emitCall(client: any, raw: Record<string, unknown>): any {
      const received: any[] = [];
      client.on("call", (c: unknown) => received.push(c));
      client.handleCallEvent(raw);
      return received[0];
    }

    it("normalizes a Baileys call event", () => {
      const client = makeConnectedClient();
      const date = new Date("2026-09-02T00:00:00Z");

      const call = emitCall(client, {
        id: "call-1",
        from: CALLER,
        chatId: CALLER,
        date,
        isVideo: true,
        status: "offer",
        offline: false,
      });

      expect(call).toMatchObject({
        id: "call-1",
        from: CALLER,
        chatId: CALLER,
        isGroup: false,
        isVideo: true,
        status: "offer",
        date,
        offline: false,
      });
    });

    it("prefers callerPn over from, and surfaces it as callerPhone", () => {
      const client = makeConnectedClient();

      const call = emitCall(client, {
        id: "call-2",
        from: "123456@lid",
        callerPn: CALLER,
        chatId: "123456@lid",
        date: new Date(),
        status: "offer",
      });

      expect(call.from).toBe(CALLER);
      expect(call.callerPhone).toBe(CALLER);
    });

    it("carries group fields for a group call", () => {
      const client = makeConnectedClient();

      const call = emitCall(client, {
        id: "call-3",
        from: CALLER,
        chatId: "120363@g.us",
        isGroup: true,
        groupJid: "120363@g.us",
        date: new Date(),
        status: "ringing",
      });

      expect(call.isGroup).toBe(true);
      expect(call.groupJid).toBe("120363@g.us");
    });

    it("coerces absent booleans rather than leaking undefined", () => {
      const client = makeConnectedClient();

      const call = emitCall(client, {
        id: "call-4",
        from: CALLER,
        chatId: CALLER,
        date: new Date(),
        status: "terminate",
      });

      expect(call.isGroup).toBe(false);
      expect(call.isVideo).toBe(false);
      expect(call.offline).toBe(false);
      expect(call.groupJid).toBeUndefined();
    });

    it("substitutes a Date when the event carries a malformed one", () => {
      // This crosses a protocol boundary; a bad payload must not take the
      // listener down or hand consumers a non-Date in a Date field.
      const client = makeConnectedClient();

      const call = emitCall(client, {
        id: "call-5",
        from: CALLER,
        chatId: CALLER,
        date: "not-a-date",
        status: "offer",
      });

      expect(call.date).toBeInstanceOf(Date);
    });

    it("keeps the raw event for advanced use", () => {
      const client = makeConnectedClient();
      const raw = {
        id: "call-6",
        from: CALLER,
        chatId: CALLER,
        date: new Date(),
        status: "offer",
        somethingNew: "kept",
      };

      const call = emitCall(client, raw);

      expect(call.raw).toBe(raw);
    });

    it("emits nothing for a null event", () => {
      const client = makeConnectedClient();
      const received: unknown[] = [];
      client.on("call", (c: unknown) => received.push(c));

      client.handleCallEvent(null);

      expect(received).toHaveLength(0);
    });
  });

  describe("listener wiring", () => {
    // registerSocketEvents and removeSocketEvents both maintain hand-written
    // lists of event names. Adding to one and forgetting the other leaks a
    // listener across reconnects, and neither list is checked by the compiler.
    function captureWiring() {
      const registered: string[] = [];
      const removed: string[] = [];
      const client: any = new MiawClient({ instanceId: "test-call-wiring" });
      client.socket = {
        ev: {
          on: (name: string) => registered.push(name),
          removeAllListeners: (name: string) => removed.push(name),
        },
      };
      client.registerSocketEvents(async () => {});
      client.removeSocketEvents();
      return { registered, removed };
    }

    it("registers a listener for the call event", () => {
      expect(captureWiring().registered).toContain("call");
    });

    it("removes the call listener on teardown", () => {
      expect(captureWiring().removed).toContain("call");
    });

    it("removes every event it registers", () => {
      const { registered, removed } = captureWiring();
      // Guard against the assertion passing vacuously if wiring ever no-ops.
      expect(registered.length).toBeGreaterThan(10);
      expect(removed).toEqual(expect.arrayContaining(registered));
    });
  });

  describe("rejectCall", () => {
    it("forwards the call id and caller", async () => {
      const client = makeConnectedClient();

      const res = await client.rejectCall("call-1", CALLER);

      expect(res).toEqual({ success: true });
      expect(rejectCallMock).toHaveBeenCalledWith("call-1", CALLER);
    });

    it("returns an error result when not connected", async () => {
      const client: any = new MiawClient({ instanceId: "test-call-disc" });

      const res = await client.rejectCall("call-1", CALLER);

      expect(res.success).toBe(false);
      expect(res.error).toContain("Not connected");
    });

    it("surfaces a rejection failure as an error result", async () => {
      rejectCallMock.mockRejectedValue(new Error("too late"));
      const client = makeConnectedClient();

      await expect(client.rejectCall("call-1", CALLER)).resolves.toEqual({
        success: false,
        error: "too late",
      });
    });
  });

  describe("createCallLink", () => {
    it("defaults to a video link and omits the event when unscheduled", async () => {
      createCallLinkMock.mockResolvedValue("https://call.whatsapp.com/video/abc");
      const client = makeConnectedClient();

      const link = await client.createCallLink();

      expect(link).toBe("https://call.whatsapp.com/video/abc");
      expect(createCallLinkMock).toHaveBeenCalledWith("video", undefined);
    });

    it("passes the start time through when scheduled", async () => {
      createCallLinkMock.mockResolvedValue("https://call.whatsapp.com/audio/xyz");
      const client = makeConnectedClient();

      await client.createCallLink("audio", 1700000000);

      expect(createCallLinkMock).toHaveBeenCalledWith("audio", {
        startTime: 1700000000,
      });
    });

    it("returns null when WhatsApp returns nothing", async () => {
      createCallLinkMock.mockResolvedValue(undefined);
      const client = makeConnectedClient();

      await expect(client.createCallLink()).resolves.toBeNull();
    });

    it("returns null when not connected", async () => {
      const client: any = new MiawClient({ instanceId: "test-call-disc" });

      await expect(client.createCallLink()).resolves.toBeNull();
    });
  });
});
