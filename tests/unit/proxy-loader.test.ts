/**
 * Unit Tests for the Proxy List Loader
 *
 * Tests parseProxyList(), loadProxyList(), validateProxyList() and
 * watchProxyList() from src/utils/proxy-loader.ts
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  parseProxyList,
  loadProxyList,
  loadProxyListSync,
  validateProxyList,
  watchProxyList,
  type ProxyListWatcher,
  type ProxyPoolEntry,
} from "../../src/utils/proxy-loader.js";

describe("Proxy List Loader", () => {
  describe("parseProxyList - TXT format", () => {
    it("should parse one proxy per line", () => {
      const entries = parseProxyList(
        ["socks5://a.example.com:1080", "http://b.example.com:8080"].join("\n")
      );
      expect(entries).toHaveLength(2);
      expect(entries[0].url).toBe("socks5://a.example.com:1080");
      expect(entries[1].url).toBe("http://b.example.com:8080");
    });

    it("should skip blank lines and # / ; comments", () => {
      const entries = parseProxyList(
        [
          "# US region",
          "",
          "   ",
          "  ; disabled for now",
          "socks5://a.example.com:1080",
        ].join("\n")
      );
      expect(entries).toHaveLength(1);
    });

    it("should not treat an inline # as a comment (it would corrupt passwords)", () => {
      const entries = parseProxyList("http://user:pa%23ss@a.example.com:8080");
      expect(entries).toHaveLength(1);
      expect(entries[0].url).toContain("pa%23ss");
    });

    it("should strip trailing \\r from CRLF files", () => {
      const entries = parseProxyList(
        "socks5://a.example.com:1080\r\nhttp://b.example.com:8080\r\n"
      );
      expect(entries).toHaveLength(2);
      expect(entries[0].url).toBe("socks5://a.example.com:1080");
      expect(entries[0].url).not.toContain("\r");
    });

    it("should parse weight and label metadata tokens", () => {
      const entries = parseProxyList(
        "http://a.example.com:8080   weight=3 label=eu"
      );
      expect(entries[0]).toEqual({
        url: "http://a.example.com:8080",
        weight: 3,
        label: "eu",
      });
    });

    it("should reject a malformed weight token", () => {
      expect(() =>
        parseProxyList("http://a.example.com:8080 weight=abc")
      ).toThrow(/malformed metadata token/);
    });

    it("should reject an unknown metadata token", () => {
      expect(() =>
        parseProxyList("http://a.example.com:8080 region=eu")
      ).toThrow(/malformed metadata token/);
    });

    it("should expand scheme-less host:port using defaultProtocol", () => {
      const entries = parseProxyList("1.2.3.4:8080", {
        defaultProtocol: "socks5",
      });
      expect(entries[0].url).toBe("socks5://1.2.3.4:8080");
    });

    it("should default scheme-less lines to http", () => {
      expect(parseProxyList("1.2.3.4:8080")[0].url).toBe("http://1.2.3.4:8080");
    });

    it("should expand the vendor host:port:user:pass form", () => {
      const entries = parseProxyList("1.2.3.4:8080:myuser:mypass");
      expect(entries[0].url).toBe("http://myuser:mypass@1.2.3.4:8080");
    });

    it("should URL-encode credentials in the scheme-less form", () => {
      const entries = parseProxyList("1.2.3.4:8080:user:p@ss");
      expect(entries[0].url).toBe("http://user:p%40ss@1.2.3.4:8080");
      // Round-trips back to the original password.
      expect(new URL(entries[0].url).password).toBe("p%40ss");
      expect(decodeURIComponent(new URL(entries[0].url).password)).toBe("p@ss");
    });

    it("should reject an ambiguous scheme-less line", () => {
      expect(() => parseProxyList("1.2.3.4:8080:user")).toThrow(
        /unrecognized proxy format/
      );
    });

    it("should reject an unsupported protocol", () => {
      expect(() => parseProxyList("ftp://a.example.com:21")).toThrow(
        /unsupported proxy protocol/
      );
    });

    it("should not dedupe repeated proxies (a poor-man's weighting idiom)", () => {
      const entries = parseProxyList(
        ["http://a.example.com:8080", "http://a.example.com:8080"].join("\n")
      );
      expect(entries).toHaveLength(2);
    });
  });

  describe("parseProxyList - JSON format", () => {
    it("should parse an array of strings", () => {
      const entries = parseProxyList(
        JSON.stringify(["socks5://a.example.com:1080", "http://b.example.com:8080"])
      );
      expect(entries).toHaveLength(2);
    });

    it("should parse an array of objects", () => {
      const entries = parseProxyList(
        JSON.stringify([
          { url: "http://a.example.com:8080", username: "u", password: "p", weight: 3, label: "eu" },
        ])
      );
      expect(entries[0]).toEqual({
        url: "http://a.example.com:8080",
        username: "u",
        password: "p",
        weight: 3,
        label: "eu",
      });
    });

    it("should parse a mixed array", () => {
      const entries = parseProxyList(
        JSON.stringify([
          "socks5://a.example.com:1080",
          { url: "http://b.example.com:8080", weight: 2 },
        ])
      );
      expect(entries).toHaveLength(2);
      expect(entries[1].weight).toBe(2);
    });

    it('should accept the { "proxies": [...] } wrapper', () => {
      const entries = parseProxyList(
        JSON.stringify({ proxies: ["socks5://a.example.com:1080"] })
      );
      expect(entries).toHaveLength(1);
    });

    it("should throw for a JSON object that is neither an array nor a wrapper", () => {
      expect(() => parseProxyList(JSON.stringify({ strategy: "random" }))).toThrow(
        /expected an array of proxies/
      );
    });

    it("should throw for an entry missing a url field", () => {
      expect(() => parseProxyList(JSON.stringify([{ weight: 3 }]))).toThrow(
        /missing a string "url" field/
      );
    });

    it("should throw for a non-finite weight", () => {
      expect(() =>
        parseProxyList(JSON.stringify([{ url: "http://a:8080", weight: "3" }]))
      ).toThrow(/weight must be a finite number/);
    });

    it("should throw rather than fall back to txt when JSON is truncated", () => {
      // A truncated JSON file must never be reinterpreted as a list of
      // garbage "proxies".
      expect(() =>
        parseProxyList('["socks5://a.example.com:1080",', { format: "json" })
      ).toThrow(/invalid JSON/);
    });
  });

  describe("format detection", () => {
    it("should respect an explicit format option", () => {
      // Valid JSON, but forced to txt - the brackets make it an invalid URL.
      expect(() =>
        parseProxyList('["http://a.example.com:8080"]', { format: "txt" })
      ).toThrow();
    });

    it("should sniff JSON content in a .txt file", () => {
      const entries = parseProxyList('["http://a.example.com:8080"]', {
        source: "proxies.txt",
      });
      expect(entries).toHaveLength(1);
    });

    it("should sniff JSON from bare content with no source", () => {
      expect(parseProxyList('["http://a.example.com:8080"]')).toHaveLength(1);
    });
  });

  describe("strict mode and onInvalid", () => {
    it("should throw on the first invalid entry by default", () => {
      expect(() =>
        parseProxyList(["http://ok.example.com:8080", "ftp://bad:21"].join("\n"))
      ).toThrow(/unsupported proxy protocol/);
    });

    it("should include the line number in the error", () => {
      expect(() =>
        parseProxyList(["# comment", "http://ok:8080", "ftp://bad:21"].join("\n"), {
          source: "proxies.txt",
        })
      ).toThrow(/proxies\.txt:3:/);
    });

    it("should skip invalid entries and report them when strict is false", () => {
      const invalid: Array<{ line: number; reason: string; masked: string }> = [];
      const entries = parseProxyList(
        ["http://ok.example.com:8080", "ftp://bad.example.com:21"].join("\n"),
        { strict: false, onInvalid: (info) => invalid.push(info) }
      );

      expect(entries).toHaveLength(1);
      expect(invalid).toHaveLength(1);
      expect(invalid[0].line).toBe(2);
      expect(invalid[0].reason).toMatch(/unsupported proxy protocol/);
    });
  });

  describe("credential safety", () => {
    const SECRET = "s3cretpassword";

    it("should not leak the password in a thrown error", () => {
      let message = "";
      try {
        parseProxyList(`ftp://user:${SECRET}@bad.example.com:21`);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe("");
      expect(message).not.toContain(SECRET);
      expect(message).toContain("****");
    });

    it("should not leak the password in an onInvalid payload", () => {
      const seen: string[] = [];
      parseProxyList(`ftp://user:${SECRET}@bad.example.com:21`, {
        strict: false,
        onInvalid: (info) => seen.push(info.masked),
      });
      expect(seen).toHaveLength(1);
      expect(seen[0]).not.toContain(SECRET);
      expect(seen[0]).toContain("****");
    });

    it("should not leak a JSON entry's password when the entry is malformed", () => {
      let message = "";
      try {
        parseProxyList(JSON.stringify([{ password: SECRET, weight: 1 }]));
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toContain(SECRET);
    });
  });

  describe("validateProxyList", () => {
    it("should partition valid and invalid entries", () => {
      const { valid, invalid } = validateProxyList([
        "socks5://a.example.com:1080",
        "ftp://b.example.com:21",
        { url: "http://c.example.com:8080" },
      ]);
      expect(valid).toHaveLength(2);
      expect(invalid).toHaveLength(1);
      expect(invalid[0].reason).toMatch(/unsupported proxy protocol/);
    });

    it("should mask credentials in the invalid list", () => {
      const { invalid } = validateProxyList(["ftp://user:s3cret@b.example.com:21"]);
      expect(invalid[0].masked).not.toContain("s3cret");
      expect(invalid[0].masked).toContain("****");
    });
  });

  describe("file loading", () => {
    let dir: string;

    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "miaw-proxy-load-"));
    });

    afterAll(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("should load a .txt file", async () => {
      const file = path.join(dir, "proxies.txt");
      fs.writeFileSync(file, "# list\nsocks5://a.example.com:1080\n");
      await expect(loadProxyList(file)).resolves.toHaveLength(1);
    });

    it("should load a .json file", async () => {
      const file = path.join(dir, "proxies.json");
      fs.writeFileSync(file, JSON.stringify(["http://a.example.com:8080"]));
      const entries = await loadProxyList(file);
      expect(entries[0].url).toBe("http://a.example.com:8080");
    });

    it("should load synchronously", () => {
      const file = path.join(dir, "sync.txt");
      fs.writeFileSync(file, "http://a.example.com:8080\n");
      expect(loadProxyListSync(file)).toHaveLength(1);
    });

    it("should throw a clear error for a missing file", async () => {
      await expect(loadProxyList(path.join(dir, "nope.txt"))).rejects.toThrow(
        /not found or unreadable/
      );
    });

    it("should name the file in entry-level errors", async () => {
      const file = path.join(dir, "bad.txt");
      fs.writeFileSync(file, "ftp://bad.example.com:21\n");
      await expect(loadProxyList(file)).rejects.toThrow(/bad\.txt:1:/);
    });
  });

  describe("watchProxyList", () => {
    let dir: string;
    let watcher: ProxyListWatcher | undefined;

    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "miaw-proxy-watch-"));
    });

    afterAll(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    afterEach(() => {
      watcher?.close();
      watcher = undefined;
    });

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    /**
     * fs.watchFile takes its baseline stat asynchronously. Writing in the
     * same tick races that: if the baseline lands after the write, prev and
     * curr are identical and no change is ever reported. Give it a beat.
     */
    const settleBaseline = () => sleep(200);

    /** Waits for the next onChange, or rejects on timeout. */
    function nextChange(
      file: string,
      onError?: (e: Error) => void
    ): { promise: Promise<ProxyPoolEntry[]>; watcher: ProxyListWatcher } {
      let resolve!: (entries: ProxyPoolEntry[]) => void;
      const promise = new Promise<ProxyPoolEntry[]>((res) => {
        resolve = res;
      });
      const w = watchProxyList(file, resolve, {
        interval: 50,
        debounceMs: 20,
        onError,
      });
      return { promise, watcher: w };
    }

    it("should report the reparsed list when the file changes", async () => {
      const file = path.join(dir, "live.txt");
      fs.writeFileSync(file, "http://a.example.com:8080\n");

      const { promise, watcher: w } = nextChange(file);
      watcher = w;
      await settleBaseline();

      fs.writeFileSync(
        file,
        "http://a.example.com:8080\nhttp://b.example.com:8080\n"
      );

      const entries = await promise;
      expect(entries).toHaveLength(2);
    });

    it("should keep the previous list when a reload yields no valid entries", async () => {
      const file = path.join(dir, "truncated.txt");
      fs.writeFileSync(file, "http://a.example.com:8080\n");

      const changes: ProxyPoolEntry[][] = [];
      const errors: Error[] = [];
      watcher = watchProxyList(file, (e) => changes.push(e), {
        interval: 50,
        debounceMs: 20,
        onError: (e) => errors.push(e),
      });
      await settleBaseline();

      // Simulates the truncate-then-write race.
      fs.writeFileSync(file, "");

      await sleep(400);

      expect(changes).toHaveLength(0);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toMatch(/keeping the previous list/);
    });

    it("should report an error but keep watching when the file is deleted", async () => {
      const file = path.join(dir, "deleted.txt");
      fs.writeFileSync(file, "http://a.example.com:8080\n");

      const changes: ProxyPoolEntry[][] = [];
      const errors: Error[] = [];
      watcher = watchProxyList(file, (e) => changes.push(e), {
        interval: 50,
        debounceMs: 20,
        onError: (e) => errors.push(e),
      });
      await settleBaseline();

      fs.rmSync(file);
      await sleep(400);
      expect(errors.some((e) => /disappeared/.test(e.message))).toBe(true);

      // The file coming back must still be picked up.
      fs.writeFileSync(
        file,
        "http://a.example.com:8080\nhttp://b.example.com:8080\n"
      );
      await sleep(500);
      expect(changes.length).toBeGreaterThan(0);
      expect(changes[changes.length - 1]).toHaveLength(2);
    });

    it("should stop reporting after close() and be idempotent", async () => {
      const file = path.join(dir, "closed.txt");
      fs.writeFileSync(file, "http://a.example.com:8080\n");

      const changes: ProxyPoolEntry[][] = [];
      const w = watchProxyList(file, (e) => changes.push(e), {
        interval: 50,
        debounceMs: 20,
      });
      await settleBaseline();

      w.close();
      w.close(); // idempotent

      fs.writeFileSync(
        file,
        "http://a.example.com:8080\nhttp://b.example.com:8080\n"
      );
      await sleep(400);

      expect(changes).toHaveLength(0);
    });
  });
});
