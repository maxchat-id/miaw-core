/**
 * Unit Tests: BrowserPresets
 *
 * These tuples are duplicated from Baileys' own `Browsers` map rather than
 * re-exported (see src/utils/browser-presets.ts for why), which means they can
 * drift. This suite pins them against the real module so a change upstream
 * shows up here instead of as a mysterious pairing failure.
 */

import { describe, it, expect } from "@jest/globals";
import { BrowserPresets } from "../../src/utils/browser-presets.js";

// Deliberately unmocked -- the point is to compare against the real tuples.
const { Browsers } = await import("@whiskeysockets/baileys");

describe("BrowserPresets", () => {
  describe("shape", () => {
    it.each(["macOS", "windows", "ubuntu", "android"] as const)(
      "%s returns a three-part tuple of strings",
      (preset) => {
        const tuple = BrowserPresets[preset]();
        expect(tuple).toHaveLength(3);
        for (const part of tuple) {
          expect(typeof part).toBe("string");
        }
      }
    );
  });

  describe("parity with Baileys' Browsers map", () => {
    it("macOS matches", () => {
      expect(BrowserPresets.macOS("Chrome")).toEqual(Browsers.macOS("Chrome"));
    });

    it("windows matches", () => {
      expect(BrowserPresets.windows("Chrome")).toEqual(
        Browsers.windows("Chrome")
      );
    });

    it("ubuntu matches", () => {
      expect(BrowserPresets.ubuntu("Chrome")).toEqual(Browsers.ubuntu("Chrome"));
    });

    it("android matches", () => {
      expect(BrowserPresets.android("13")).toEqual(Browsers.android("13"));
    });
  });

  describe("android", () => {
    it("puts the literal 'Android' in the slot the handshake sniffs", () => {
      // validate-connection.js selects Platform.ANDROID over Platform.WEB by
      // testing browser[1] for "android". If the slot order ever changes, the
      // preset silently degrades to a web handshake.
      expect(BrowserPresets.android()[1].toLocaleLowerCase()).toContain(
        "android"
      );
    });

    it("carries the requested version in the os slot", () => {
      expect(BrowserPresets.android("14")[0]).toBe("14");
    });

    it("defaults to Android 13", () => {
      expect(BrowserPresets.android()[0]).toBe("13");
    });
  });

  describe("defaults", () => {
    it("macOS defaults to Chrome, matching MiawClient's default identity", () => {
      expect(BrowserPresets.macOS()[1]).toBe("Chrome");
    });

    it("never produces a 'Desktop' browser name, which WhatsApp 428s", () => {
      for (const preset of ["macOS", "windows", "ubuntu", "android"] as const) {
        expect(BrowserPresets[preset]()[1]).not.toBe("Desktop");
      }
    });
  });
});
