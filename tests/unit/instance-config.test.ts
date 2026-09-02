/**
 * Unit Tests for the Per-Instance CLI Configuration Store
 *
 * Tests src/cli/utils/instance-config.ts - the `<sessionPath>/instances.json`
 * pin store. Fully offline: no client is ever constructed.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  getInstanceConfigPath,
  readInstanceConfig,
  getInstanceRecord,
  getPinnedProxy,
  setInstanceProxyPin,
  clearInstanceProxyPin,
  deleteInstanceRecord,
  listPinnedInstanceIds,
  describePin,
} from "../../src/cli/utils/instance-config.js";

/** A password that must never appear in any output or error message. */
const SECRET = "sup3rs3cr3t";
const URL_WITH_SECRET = `socks5://user:${SECRET}@proxy.example.com:1080`;

const isWindows = process.platform === "win32";

describe("Instance Config Store", () => {
  let sessionPath: string;

  beforeEach(() => {
    sessionPath = fs.mkdtempSync(path.join(os.tmpdir(), "miaw-instance-config-"));
  });

  afterEach(() => {
    fs.rmSync(sessionPath, { recursive: true, force: true });
  });

  describe("readInstanceConfig", () => {
    it("should return an empty config when the file does not exist", () => {
      const config = readInstanceConfig(sessionPath);
      expect(config.version).toBe(1);
      expect(config.instances).toEqual({});
    });

    it("should throw rather than silently treat malformed JSON as empty", () => {
      // Falling back to empty would mean "no proxy pinned", which would connect
      // directly and leak the real IP.
      fs.writeFileSync(getInstanceConfigPath(sessionPath), "{ not json");
      expect(() => readInstanceConfig(sessionPath)).toThrow(/not valid JSON/);
    });

    it("should name the offending path in the error", () => {
      const filePath = getInstanceConfigPath(sessionPath);
      fs.writeFileSync(filePath, "{ not json");
      expect(() => readInstanceConfig(sessionPath)).toThrow(filePath);
    });

    it("should reject a JSON array", () => {
      fs.writeFileSync(getInstanceConfigPath(sessionPath), "[]");
      expect(() => readInstanceConfig(sessionPath)).toThrow(/must contain a JSON object/);
    });

    it("should reject an object with no instances key", () => {
      fs.writeFileSync(getInstanceConfigPath(sessionPath), '{"version":1}');
      expect(() => readInstanceConfig(sessionPath)).toThrow(/missing an "instances" object/);
    });
  });

  describe("setInstanceProxyPin", () => {
    it("should round-trip a url pin", () => {
      setInstanceProxyPin(sessionPath, "bot-eu", { url: "socks5://eu.example.com:1080" });
      expect(getPinnedProxy(sessionPath, "bot-eu")?.url).toBe("socks5://eu.example.com:1080");
    });

    it("should round-trip a label pin", () => {
      setInstanceProxyPin(sessionPath, "bot-asia", { label: "asia" });
      const pin = getPinnedProxy(sessionPath, "bot-asia");
      expect(pin?.label).toBe("asia");
      expect(pin?.url).toBeUndefined();
    });

    it("should stamp updatedAt", () => {
      setInstanceProxyPin(sessionPath, "bot", { label: "eu" });
      expect(getPinnedProxy(sessionPath, "bot")?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("should overwrite an existing pin", () => {
      setInstanceProxyPin(sessionPath, "bot", { url: "socks5://a.example.com:1080" });
      setInstanceProxyPin(sessionPath, "bot", { url: "socks5://b.example.com:1080" });
      expect(getPinnedProxy(sessionPath, "bot")?.url).toBe("socks5://b.example.com:1080");
    });

    it("should replace a url pin with a label pin, leaving no stale url", () => {
      setInstanceProxyPin(sessionPath, "bot", { url: URL_WITH_SECRET });
      setInstanceProxyPin(sessionPath, "bot", { label: "eu" });
      const pin = getPinnedProxy(sessionPath, "bot");
      expect(pin?.label).toBe("eu");
      expect(pin?.url).toBeUndefined();
      expect(fs.readFileSync(getInstanceConfigPath(sessionPath), "utf-8")).not.toContain(SECRET);
    });

    it("should reject a pin with both url and label", () => {
      expect(() =>
        setInstanceProxyPin(sessionPath, "bot", { url: "socks5://a.example.com:1080", label: "eu" })
      ).toThrow(/not both/);
    });

    it("should reject a pin with neither url nor label", () => {
      expect(() => setInstanceProxyPin(sessionPath, "bot", {})).toThrow(/needs either/);
    });

    it("should reject an unsupported protocol", () => {
      expect(() => setInstanceProxyPin(sessionPath, "bot", { url: "ftp://a.example.com:21" })).toThrow(
        /Invalid proxy configuration/
      );
    });

    it("should reject an unparseable url", () => {
      expect(() => setInstanceProxyPin(sessionPath, "bot", { url: "not-a-url" })).toThrow(
        /Invalid proxy configuration/
      );
    });

    it("should not write anything when the pin is rejected", () => {
      expect(() => setInstanceProxyPin(sessionPath, "bot", { url: "ftp://a.example.com:21" })).toThrow();
      expect(fs.existsSync(getInstanceConfigPath(sessionPath))).toBe(false);
    });

    it("should not leak the password in a rejection message", () => {
      // maskProxyUrl keeps the username (sticky sessions) but never the password.
      try {
        setInstanceProxyPin(sessionPath, "bot", { url: `ftp://user:${SECRET}@a.example.com:21` });
        throw new Error("expected a rejection");
      } catch (error) {
        expect((error as Error).message).not.toContain(SECRET);
      }
    });

    it("should keep instances independent", () => {
      setInstanceProxyPin(sessionPath, "bot-a", { url: "socks5://a.example.com:1080" });
      setInstanceProxyPin(sessionPath, "bot-b", { url: "socks5://b.example.com:1080" });
      expect(getPinnedProxy(sessionPath, "bot-a")?.url).toBe("socks5://a.example.com:1080");
      expect(getPinnedProxy(sessionPath, "bot-b")?.url).toBe("socks5://b.example.com:1080");
    });

    it("should create the session directory when it does not exist yet", () => {
      // Pinning before `instance create` is the supported workflow.
      const fresh = path.join(sessionPath, "nested", "deeper");
      setInstanceProxyPin(fresh, "bot", { label: "eu" });
      expect(getPinnedProxy(fresh, "bot")?.label).toBe("eu");
    });
  });

  describe("file hygiene", () => {
    (isWindows ? it.skip : it)("should write the file 0600", () => {
      setInstanceProxyPin(sessionPath, "bot", { url: URL_WITH_SECRET });
      const mode = fs.statSync(getInstanceConfigPath(sessionPath)).mode & 0o777;
      expect(mode).toBe(0o600);
    });

    (isWindows ? it.skip : it)("should tighten permissions on a pre-existing loose file", () => {
      const filePath = getInstanceConfigPath(sessionPath);
      fs.writeFileSync(filePath, '{"version":1,"instances":{}}', { mode: 0o644 });
      setInstanceProxyPin(sessionPath, "bot", { label: "eu" });
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    });

    it("should leave no temp file behind", () => {
      setInstanceProxyPin(sessionPath, "bot", { label: "eu" });
      const leftovers = fs.readdirSync(sessionPath).filter((f) => f.endsWith(".tmp"));
      expect(leftovers).toEqual([]);
    });

    it("should produce a file that parses back", () => {
      setInstanceProxyPin(sessionPath, "bot", { url: URL_WITH_SECRET });
      const raw = fs.readFileSync(getInstanceConfigPath(sessionPath), "utf-8");
      expect(() => JSON.parse(raw)).not.toThrow();
      expect(raw.endsWith("\n")).toBe(true);
    });

    it("should store no credentials at all for a label pin", () => {
      setInstanceProxyPin(sessionPath, "bot", { label: "eu" });
      const raw = fs.readFileSync(getInstanceConfigPath(sessionPath), "utf-8");
      expect(raw).not.toContain(SECRET);
      expect(raw).not.toContain("://");
    });
  });

  describe("clearInstanceProxyPin", () => {
    it("should return true and remove the pin", () => {
      setInstanceProxyPin(sessionPath, "bot", { label: "eu" });
      expect(clearInstanceProxyPin(sessionPath, "bot")).toBe(true);
      expect(getPinnedProxy(sessionPath, "bot")).toBeUndefined();
    });

    it("should return false when nothing was pinned", () => {
      expect(clearInstanceProxyPin(sessionPath, "bot")).toBe(false);
    });

    it("should return false on a second call", () => {
      setInstanceProxyPin(sessionPath, "bot", { label: "eu" });
      clearInstanceProxyPin(sessionPath, "bot");
      expect(clearInstanceProxyPin(sessionPath, "bot")).toBe(false);
    });

    it("should drop the now-empty record entirely", () => {
      setInstanceProxyPin(sessionPath, "bot", { label: "eu" });
      clearInstanceProxyPin(sessionPath, "bot");
      expect(getInstanceRecord(sessionPath, "bot")).toBeUndefined();
    });

    it("should not disturb other instances", () => {
      setInstanceProxyPin(sessionPath, "bot-a", { label: "eu" });
      setInstanceProxyPin(sessionPath, "bot-b", { label: "asia" });
      clearInstanceProxyPin(sessionPath, "bot-a");
      expect(getPinnedProxy(sessionPath, "bot-b")?.label).toBe("asia");
    });
  });

  describe("deleteInstanceRecord", () => {
    it("should remove only the named instance", () => {
      setInstanceProxyPin(sessionPath, "bot-a", { label: "eu" });
      setInstanceProxyPin(sessionPath, "bot-b", { label: "asia" });
      deleteInstanceRecord(sessionPath, "bot-a");
      expect(getPinnedProxy(sessionPath, "bot-a")).toBeUndefined();
      expect(getPinnedProxy(sessionPath, "bot-b")?.label).toBe("asia");
    });

    it("should be a no-op for an unknown instance", () => {
      setInstanceProxyPin(sessionPath, "bot", { label: "eu" });
      expect(() => deleteInstanceRecord(sessionPath, "ghost")).not.toThrow();
      expect(getPinnedProxy(sessionPath, "bot")?.label).toBe("eu");
    });

    it("should be a no-op when no config file exists", () => {
      expect(() => deleteInstanceRecord(sessionPath, "ghost")).not.toThrow();
    });
  });

  describe("listPinnedInstanceIds", () => {
    it("should return an empty list with no config", () => {
      expect(listPinnedInstanceIds(sessionPath)).toEqual([]);
    });

    it("should list pinned ids sorted", () => {
      setInstanceProxyPin(sessionPath, "zeta", { label: "z" });
      setInstanceProxyPin(sessionPath, "alpha", { label: "a" });
      expect(listPinnedInstanceIds(sessionPath)).toEqual(["alpha", "zeta"]);
    });

    it("should include ids with no session directory yet", () => {
      setInstanceProxyPin(sessionPath, "not-created-yet", { label: "eu" });
      expect(listPinnedInstanceIds(sessionPath)).toContain("not-created-yet");
    });
  });

  describe("describePin", () => {
    it("should mask a url pin's password", () => {
      const described = describePin({ url: URL_WITH_SECRET });
      expect(described).not.toContain(SECRET);
      expect(described).toContain("proxy.example.com");
    });

    it("should render a label pin", () => {
      expect(describePin({ label: "asia" })).toBe("label:asia");
    });

    it("should return null for no pin", () => {
      expect(describePin(undefined)).toBeNull();
      expect(describePin({})).toBeNull();
    });
  });
});
