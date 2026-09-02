/**
 * Unit tests for the shared CLI argument parsers.
 *
 * These parsers gate destructive operations — a wrong answer silently changes a
 * group setting for every member rather than erroring — so each one is tested
 * directly here, not only through the router.
 */

import { describe, it, expect } from "@jest/globals";
import {
  parseToggle,
  parseEphemeral,
  parseMemberAddMode,
  EPHEMERAL_ALIASES,
} from "../../src/cli/utils/parse-args.js";

describe("parseToggle", () => {
  it.each(["on", "true", "yes", "1", "ON", "True", "YES"])(
    "%s is true",
    (value) => {
      expect(parseToggle(value)).toBe(true);
    }
  );

  it.each(["off", "false", "no", "0", "OFF", "False", "NO"])(
    "%s is false",
    (value) => {
      expect(parseToggle(value)).toBe(false);
    }
  );

  it.each([undefined, "", "maybe", "enable", "2", "onoff"])(
    "%s is rejected rather than guessed",
    (value) => {
      expect(parseToggle(value)).toBeNull();
    }
  );
});

describe("parseMemberAddMode", () => {
  it.each(["admin", "admin_add", "admins", "ADMIN"])(
    "%s maps to admin_add",
    (value) => {
      expect(parseMemberAddMode(value)).toBe("admin_add");
    }
  );

  it.each(["all", "all_member_add", "members", "ALL"])(
    "%s maps to all_member_add",
    (value) => {
      expect(parseMemberAddMode(value)).toBe("all_member_add");
    }
  );

  it.each([undefined, "", "everyone", "nobody"])("%s is rejected", (value) => {
    expect(parseMemberAddMode(value)).toBeNull();
  });
});

describe("parseEphemeral", () => {
  it.each(Object.entries(EPHEMERAL_ALIASES))(
    "alias %s resolves to %s seconds",
    (alias, seconds) => {
      expect(parseEphemeral(alias)).toBe(seconds);
    }
  );

  it("is case-insensitive", () => {
    expect(parseEphemeral("7D")).toBe(604800);
    expect(parseEphemeral("OFF")).toBe(0);
  });

  it("accepts a raw second count", () => {
    expect(parseEphemeral("3600")).toBe(3600);
  });

  it("accepts an explicit '0' as off", () => {
    // Distinct from the missing-value case below: typing 0 really does mean off.
    expect(parseEphemeral("0")).toBe(0);
  });

  describe("missing value", () => {
    // Regression: `Number("")` is 0, and 0 is a *valid* duration meaning "off".
    // Without an explicit empty guard, omitting the argument parsed as a
    // successful request to disable disappearing messages, so
    // `miaw-cli group ephemeral <jid>` silently turned them off for the whole
    // group instead of printing a usage line.
    it.each([undefined, "", "   "])("%s is null, not 0", (value) => {
      expect(parseEphemeral(value)).toBeNull();
    });
  });

  it.each(["soon", "7days", "-1", "1.5", "NaN", "24 h"])(
    "%s is rejected",
    (value) => {
      expect(parseEphemeral(value)).toBeNull();
    }
  );

  it("accepts exponent notation, which is an unambiguous integer", () => {
    expect(parseEphemeral("1e3")).toBe(1000);
  });
});
