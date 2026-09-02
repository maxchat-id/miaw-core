/**
 * Unit Tests for Per-Instance Proxy Precedence
 *
 * Tests src/cli/utils/proxy-resolver.ts. Fully offline - no proxy is dialled
 * and no client is constructed; resolution only reads files.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  resolveProxyForInstance,
  buildClientConfig,
  buildClientConfigLenient,
  describePinnedProxy,
  describeProxySource,
  baseOf,
  type ProxyResolutionBase,
} from "../../src/cli/utils/proxy-resolver.js";
import { setInstanceProxyPin } from "../../src/cli/utils/instance-config.js";

const FIXTURE = path.join(process.cwd(), "tests/fixtures/proxies.txt");

/** The password inside the fixture's eu entry. Must never escape masked output. */
const FIXTURE_SECRET = "s3cretpassword";

describe("Proxy Resolver", () => {
  let sessionPath: string;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errSpy: ReturnType<typeof jest.spyOn>;

  const base = (over: Partial<ProxyResolutionBase> = {}): ProxyResolutionBase => ({
    sessionPath,
    ...over,
  });

  beforeEach(() => {
    sessionPath = fs.mkdtempSync(path.join(os.tmpdir(), "miaw-proxy-resolver-"));
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    fs.rmSync(sessionPath, { recursive: true, force: true });
  });

  describe("precedence", () => {
    it("should return direct when nothing is configured", async () => {
      const resolved = await resolveProxyForInstance(base(), "bot");
      expect(resolved.source).toBe("none");
      expect(resolved.url).toBeUndefined();
      expect(resolved.masked).toBeUndefined();
    });

    it("should use --proxy when only a flag is given", async () => {
      const resolved = await resolveProxyForInstance(
        base({ explicitProxy: "socks5://flag.example.com:1080" }),
        "bot"
      );
      expect(resolved.source).toBe("flag");
      expect(resolved.url).toBe("socks5://flag.example.com:1080");
    });

    it("should use a pin when only a pin exists", async () => {
      setInstanceProxyPin(sessionPath, "bot", { url: "socks5://pin.example.com:1080" });
      const resolved = await resolveProxyForInstance(base(), "bot");
      expect(resolved.source).toBe("pin");
      expect(resolved.url).toBe("socks5://pin.example.com:1080");
    });

    it("should use the proxy file when only a file is given", async () => {
      const resolved = await resolveProxyForInstance(base({ proxyFile: FIXTURE }), "bot");
      expect(resolved.source).toBe("file");
      expect(resolved.url).toBeDefined();
    });

    it("should let --proxy beat a pin", async () => {
      setInstanceProxyPin(sessionPath, "bot", { url: "socks5://pin.example.com:1080" });
      const resolved = await resolveProxyForInstance(
        base({ explicitProxy: "socks5://flag.example.com:1080" }),
        "bot"
      );
      expect(resolved.source).toBe("flag");
      expect(resolved.overrodePin).toBe(true);
    });

    it("should let --proxy beat a proxy file", async () => {
      const resolved = await resolveProxyForInstance(
        base({ explicitProxy: "socks5://flag.example.com:1080", proxyFile: FIXTURE }),
        "bot"
      );
      expect(resolved.source).toBe("flag");
    });

    it("should let a pin beat a proxy file", async () => {
      setInstanceProxyPin(sessionPath, "bot", { url: "socks5://pin.example.com:1080" });
      const resolved = await resolveProxyForInstance(base({ proxyFile: FIXTURE }), "bot");
      expect(resolved.source).toBe("pin");
      expect(resolved.url).toBe("socks5://pin.example.com:1080");
    });

    it("should not set overrodePin when no pin existed", async () => {
      const resolved = await resolveProxyForInstance(
        base({ explicitProxy: "socks5://flag.example.com:1080" }),
        "bot"
      );
      expect(resolved.overrodePin).toBeUndefined();
    });

    it("should apply a pin only to the instance it belongs to", async () => {
      setInstanceProxyPin(sessionPath, "bot-a", { url: "socks5://a.example.com:1080" });
      expect((await resolveProxyForInstance(base(), "bot-a")).source).toBe("pin");
      expect((await resolveProxyForInstance(base(), "bot-b")).source).toBe("none");
    });
  });

  describe("override warnings", () => {
    it("should warn when --proxy shadows a pin", async () => {
      setInstanceProxyPin(sessionPath, "bot", { url: "socks5://pin.example.com:1080" });
      await resolveProxyForInstance(base({ explicitProxy: "socks5://flag.example.com:1080" }), "bot");
      const output = logSpy.mock.calls.flat().join("\n");
      expect(output).toContain("overrides the pinned proxy");
      expect(output).toContain("bot");
    });

    it("should warn when --proxy shadows --proxy-file", async () => {
      await resolveProxyForInstance(
        base({ explicitProxy: "socks5://flag.example.com:1080", proxyFile: FIXTURE }),
        "bot"
      );
      expect(logSpy.mock.calls.flat().join("\n")).toContain("--proxy overrides --proxy-file");
    });

    it("should not warn when there is nothing to override", async () => {
      await resolveProxyForInstance(base({ explicitProxy: "socks5://flag.example.com:1080" }), "bot");
      expect(logSpy.mock.calls.flat().join("\n")).not.toContain("overrides");
    });

    it("should mask the pinned password in the override warning", async () => {
      setInstanceProxyPin(sessionPath, "bot", {
        url: `http://user:${FIXTURE_SECRET}@pin.example.com:8080`,
      });
      await resolveProxyForInstance(base({ explicitProxy: "socks5://flag.example.com:1080" }), "bot");
      expect(logSpy.mock.calls.flat().join("\n")).not.toContain(FIXTURE_SECRET);
    });
  });

  describe("deterministic file selection", () => {
    it("should be stable for one instance across calls", async () => {
      const a = await resolveProxyForInstance(base({ proxyFile: FIXTURE }), "bot-1");
      const b = await resolveProxyForInstance(base({ proxyFile: FIXTURE }), "bot-1");
      expect(a.url).toBe(b.url);
    });

    it("should spread different instances across the pool", async () => {
      const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
      const picked = new Set<string>();
      for (const id of ids) {
        const resolved = await resolveProxyForInstance(base({ proxyFile: FIXTURE }), id);
        picked.add(resolved.url!);
      }
      expect(picked.size).toBeGreaterThan(1);
    });
  });

  describe("label pins", () => {
    it("should resolve a label to its pool entry", async () => {
      setInstanceProxyPin(sessionPath, "bot", { label: "us" });
      const resolved = await resolveProxyForInstance(base({ proxyFile: FIXTURE }), "bot");
      expect(resolved.source).toBe("pin-label");
      expect(resolved.url).toBe("socks5://us1.example.com:1080");
    });

    it("should throw when the label matches nothing", async () => {
      setInstanceProxyPin(sessionPath, "bot", { label: "antarctica" });
      await expect(resolveProxyForInstance(base({ proxyFile: FIXTURE }), "bot")).rejects.toThrow(
        /matches no entry/
      );
    });

    it("should throw when a label pin has no proxy file configured", async () => {
      // Never silently degrade to direct: the operator asked for a specific
      // egress IP, and ignoring that leaks the real one.
      setInstanceProxyPin(sessionPath, "bot", { label: "us" });
      await expect(resolveProxyForInstance(base(), "bot")).rejects.toThrow(
        /no proxy file is configured/
      );
    });

    it("should name the instance in a label failure", async () => {
      setInstanceProxyPin(sessionPath, "bot-eu", { label: "nope" });
      await expect(resolveProxyForInstance(base({ proxyFile: FIXTURE }), "bot-eu")).rejects.toThrow(
        /bot-eu/
      );
    });
  });

  describe("credential safety", () => {
    it("should never expose a password in the serialized result", async () => {
      setInstanceProxyPin(sessionPath, "bot", { label: "eu" });
      const resolved = await resolveProxyForInstance(base({ proxyFile: FIXTURE }), "bot");
      // The raw url intentionally carries credentials for the socket layer,
      // but `masked` is what callers display.
      expect(resolved.masked).not.toContain(FIXTURE_SECRET);
      expect(resolved.masked).toContain("eu1.example.com");
    });

    it("should keep the username in the masked form for sticky sessions", async () => {
      setInstanceProxyPin(sessionPath, "bot", { label: "eu" });
      const resolved = await resolveProxyForInstance(base({ proxyFile: FIXTURE }), "bot");
      expect(resolved.masked).toContain("euuser");
    });
  });

  describe("buildClientConfig", () => {
    it("should carry the resolution inputs so another instance can re-resolve", async () => {
      const config = await buildClientConfig(
        base({ proxyFile: FIXTURE, proxyStrategy: "deterministic", debug: true }),
        "bot"
      );
      expect(config.instanceId).toBe("bot");
      expect(config.sessionPath).toBe(sessionPath);
      expect(config.debug).toBe(true);
      expect(config.proxyFile).toBe(FIXTURE);
      expect(config.proxyStrategy).toBe("deterministic");
      expect(config.proxy).toBeDefined();
    });

    it("should omit proxy entirely for a direct connection", async () => {
      const config = await buildClientConfig(base(), "bot");
      expect("proxy" in config).toBe(false);
    });

    it("should round-trip through baseOf for a different instance", async () => {
      setInstanceProxyPin(sessionPath, "bot-a", { url: "socks5://a.example.com:1080" });
      setInstanceProxyPin(sessionPath, "bot-b", { url: "socks5://b.example.com:1080" });

      const configA = await buildClientConfig(base(), "bot-a");
      // This is the instance-switch path: re-resolving must NOT inherit bot-a's proxy.
      const configB = await buildClientConfig(baseOf(configA), "bot-b");

      expect(configA.proxy).toBe("socks5://a.example.com:1080");
      expect(configB.proxy).toBe("socks5://b.example.com:1080");
    });

    it("should drop the previous proxy when the next instance has none", async () => {
      setInstanceProxyPin(sessionPath, "bot-a", { url: "socks5://a.example.com:1080" });
      const configA = await buildClientConfig(base(), "bot-a");
      const configB = await buildClientConfig(baseOf(configA), "bot-b");
      expect(configB.proxy).toBeUndefined();
    });

    it("should preserve explicitProxy across a switch", async () => {
      const configA = await buildClientConfig(
        base({ explicitProxy: "socks5://flag.example.com:1080" }),
        "bot-a"
      );
      const configB = await buildClientConfig(baseOf(configA), "bot-b");
      expect(configB.proxy).toBe("socks5://flag.example.com:1080");
      expect(configB.explicitProxy).toBe("socks5://flag.example.com:1080");
    });
  });

  describe("describePinnedProxy", () => {
    it("should return null when nothing is pinned", () => {
      expect(describePinnedProxy(sessionPath, "bot")).toBeNull();
    });

    it("should mask a url pin", () => {
      setInstanceProxyPin(sessionPath, "bot", {
        url: `http://user:${FIXTURE_SECRET}@pin.example.com:8080`,
      });
      const described = describePinnedProxy(sessionPath, "bot");
      expect(described).not.toContain(FIXTURE_SECRET);
      expect(described).toContain("pin.example.com");
    });

    it("should render a label pin without reading the proxy file", () => {
      setInstanceProxyPin(sessionPath, "bot", { label: "us" });
      expect(describePinnedProxy(sessionPath, "bot")).toBe("label:us");
    });
  });

  describe("describeProxySource", () => {
    it("should name every source", () => {
      expect(describeProxySource("flag")).toBe("--proxy");
      expect(describeProxySource("pin")).toBe("pinned");
      expect(describeProxySource("pin-label")).toBe("pinned label");
      expect(describeProxySource("file")).toBe("--proxy-file");
      expect(describeProxySource("none")).toBe("direct");
    });
  });
});

describe("Proxy Resolver - failure containment", () => {
  let sessionPath: string;
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    sessionPath = fs.mkdtempSync(path.join(os.tmpdir(), "miaw-resolver-lenient-"));
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(sessionPath, { recursive: true, force: true });
  });

  describe("buildClientConfigLenient", () => {
    it("should return a config carrying proxyError instead of throwing", async () => {
      // A bad pin must not lock the operator out of `instance unset-proxy`.
      setInstanceProxyPin(sessionPath, "bot", { label: "nowhere" });
      const config = await buildClientConfigLenient({ sessionPath, proxyFile: FIXTURE }, "bot");
      expect(config.proxyError).toContain("matches no entry");
      expect(config.proxy).toBeUndefined();
    });

    it("should leave proxyError unset on success", async () => {
      setInstanceProxyPin(sessionPath, "bot", { url: "socks5://a.example.com:1080" });
      const config = await buildClientConfigLenient({ sessionPath }, "bot");
      expect(config.proxyError).toBeUndefined();
      expect(config.proxy).toBe("socks5://a.example.com:1080");
    });

    it("should not leak credentials through proxyError", async () => {
      setInstanceProxyPin(sessionPath, "bot", { label: "nowhere" });
      const config = await buildClientConfigLenient({ sessionPath, proxyFile: FIXTURE }, "bot");
      expect(config.proxyError).not.toContain(FIXTURE_SECRET);
    });
  });

  describe("quiet resolution", () => {
    it("should suppress the override warning when asked", async () => {
      setInstanceProxyPin(sessionPath, "bot", { url: "socks5://pin.example.com:1080" });
      await resolveProxyForInstance(
        { sessionPath, explicitProxy: "socks5://flag.example.com:1080" },
        "bot",
        { quiet: true }
      );
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("should still return the same result when quiet", async () => {
      setInstanceProxyPin(sessionPath, "bot", { url: "socks5://pin.example.com:1080" });
      const loud = await resolveProxyForInstance(
        { sessionPath, explicitProxy: "socks5://flag.example.com:1080" },
        "bot"
      );
      const quiet = await resolveProxyForInstance(
        { sessionPath, explicitProxy: "socks5://flag.example.com:1080" },
        "bot",
        { quiet: true }
      );
      expect(quiet).toEqual(loud);
    });
  });
});

describe("createClient proxy guard", () => {
  it("should refuse to build a client when proxy resolution failed", async () => {
    // Connecting with no proxy would leak the real IP the operator was
    // deliberately hiding, so this must throw rather than silently go direct.
    const { createClient } = await import("../../src/cli/utils/session.js");
    expect(() =>
      createClient({
        instanceId: "bot",
        sessionPath: "/tmp/miaw-guard-nope",
        proxyError: "label \"eu\" matches no entry",
      })
    ).toThrow(/Refusing to connect "bot" without its configured proxy/);
  });

  it("should build normally when no proxyError is set", async () => {
    const { createClient } = await import("../../src/cli/utils/session.js");
    expect(() =>
      createClient({ instanceId: "bot", sessionPath: "/tmp/miaw-guard-nope" })
    ).not.toThrow();
  });
});
