/**
 * Unit Tests: Baileys export surface
 *
 * Every other unit suite that touches Baileys replaces the module wholesale via
 * `jest.unstable_mockModule("@whiskeysockets/baileys", ...)`. Those factories are
 * hand-written snapshots of the export surface we happened to need when they were
 * written, so if upstream renames or removes an export, the mock keeps supplying
 * the old name, `MiawClient` keeps destructuring it, and the suite stays green
 * while the real runtime throws
 *
 *   SyntaxError: does not provide an export named '...'
 *
 * on the first real import. This file is the counterweight: it imports the REAL
 * module -- no mock -- and asserts that everything we destructure still exists
 * with the shape we assume.
 *
 * Keep the lists below in sync with the two (and only two) places miaw-core
 * imports Baileys:
 *   - src/client/MiawClient.ts:1-17
 *   - src/handlers/AuthHandler.ts:1
 *
 * If you add an import there, add it here. If this test fails after a Baileys
 * bump, that is the upgrade telling you something real broke -- do not "fix" it
 * by loosening the assertion.
 *
 * Scope: module exports only. The per-socket-method contract (sendMessage,
 * groupSettingUpdate, ...) is not checkable here without opening a WebSocket --
 * Baileys composes the socket at call time -- so that half is enforced statically
 * by `npm run build` against Baileys' .d.ts files.
 */

import { describe, it, expect } from "@jest/globals";

// Deliberately NOT mocked. This is the whole point of the file.
const baileys = await import("@whiskeysockets/baileys");

/** Runtime values destructured in src/client/MiawClient.ts:1-17. */
const CLIENT_FUNCTIONS = [
  "fetchLatestBaileysVersion",
  "fetchLatestWaWebVersion",
  "makeCacheableSignalKeyStore",
  "downloadMediaMessage",
  "jidNormalizedUser",
  "getAggregateVotesInPollMessage",
] as const;

/** Runtime value destructured in src/handlers/AuthHandler.ts:1. */
const AUTH_FUNCTIONS = ["useMultiFileAuthState"] as const;

describe("Baileys export surface (real module, unmocked)", () => {
  describe("default export", () => {
    it("exposes makeWASocket as the default export", () => {
      expect(typeof baileys.default).toBe("function");
    });

    it("also exposes makeWASocket as a named export", () => {
      expect(typeof baileys.makeWASocket).toBe("function");
    });
  });

  describe("functions", () => {
    it.each([...CLIENT_FUNCTIONS, ...AUTH_FUNCTIONS])(
      "exports %s as a function",
      (name) => {
        expect(typeof (baileys as Record<string, unknown>)[name]).toBe(
          "function"
        );
      }
    );
  });

  describe("DisconnectReason", () => {
    it("is an object", () => {
      expect(typeof baileys.DisconnectReason).toBe("object");
    });

    // MiawClient reads .loggedOut and .connectionReplaced by name and indexes the
    // enum by numeric status code to log a human-readable reason.
    it.each(["loggedOut", "connectionReplaced"])(
      "has a numeric %s member",
      (member) => {
        expect(
          typeof (baileys.DisconnectReason as Record<string, unknown>)[member]
        ).toBe("number");
      }
    );

    it("is reverse-mappable from a status code to a name", () => {
      const code = baileys.DisconnectReason.loggedOut;
      expect(
        typeof (baileys.DisconnectReason as unknown as Record<number, string>)[
          code
        ]
      ).toBe("string");
    });
  });

  describe("DEFAULT_CONNECTION_CONFIG", () => {
    // resolveWAVersion() falls back to this when both version fetches fail.
    it("carries a three-part numeric version tuple", () => {
      const { version } = baileys.DEFAULT_CONNECTION_CONFIG;
      expect(Array.isArray(version)).toBe(true);
      expect(version).toHaveLength(3);
      for (const part of version) {
        expect(typeof part).toBe("number");
      }
    });
  });

  describe("Browsers", () => {
    // macOS is the default identity (MiawClient); android is the rc14 opt-in that
    // BrowserPresets mirrors. Both must keep returning [os, browser, version].
    it.each(["macOS", "android"])("has a %s builder", (name) => {
      expect(typeof (baileys.Browsers as Record<string, unknown>)[name]).toBe(
        "function"
      );
    });

    it("Browsers.macOS returns a browser tuple", () => {
      const tuple = baileys.Browsers.macOS("Chrome");
      expect(tuple).toHaveLength(3);
      expect(tuple[1]).toBe("Chrome");
    });

    it("Browsers.android puts 'Android' in the slot the handshake sniffs", () => {
      // validate-connection.js and socket.js both switch on
      // browser[1].toLocaleLowerCase().includes('android') to select
      // Platform.ANDROID over Platform.WEB. BrowserPresets.android() mirrors this
      // tuple, so if upstream reorders it our preset silently stops working.
      const tuple = baileys.Browsers.android("13");
      expect(tuple).toHaveLength(3);
      expect(tuple[1].toLocaleLowerCase()).toContain("android");
    });
  });
});
