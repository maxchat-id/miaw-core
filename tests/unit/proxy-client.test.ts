/**
 * Unit Tests for MiawClient Proxy Integration
 *
 * Tests proxy-related MiawClient behavior:
 * - Constructor accepts proxy options
 * - getProxyInfo() returns correct info with masked credentials
 * - Backward compatibility without proxy
 */

import { jest, describe, beforeEach, it, expect } from "@jest/globals";
import type { Agent } from "node:https";

// Mock Baileys to prevent real connection attempts
jest.unstable_mockModule("@whiskeysockets/baileys", () => ({
  default: jest.fn(),
  makeWASocket: jest.fn(),
  DisconnectReason: { loggedOut: 401 },
  fetchLatestBaileysVersion: jest
    .fn<() => Promise<any>>()
    .mockResolvedValue({ version: [2, 2413, 1] }),
  fetchLatestWaWebVersion: jest
    .fn<() => Promise<unknown>>()
    .mockResolvedValue({ version: [2, 2413, 1], isLatest: true }),
  DEFAULT_CONNECTION_CONFIG: { version: [2, 2413, 1] },
  makeCacheableSignalKeyStore: jest.fn(),
  Browsers: { macOS: jest.fn(() => ["macOS", "Desktop", "1.0"]) },
  useMultiFileAuthState: jest.fn(),
  downloadMediaMessage: jest.fn(),
  jidNormalizedUser: jest.fn((jid: string) => jid),
  getAggregateVotesInPollMessage: jest.fn(),
}));

// Dynamic import after mocking
const baileys = await import("@whiskeysockets/baileys");
const { MiawClient } = await import("../../src/client/MiawClient.js");

describe("MiawClient Proxy Integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("constructor with proxy options", () => {
    it("should accept proxy string option", () => {
      const client = new MiawClient({
        instanceId: "test-proxy",
        proxy: "socks5://proxy.example.com:1080",
      });

      expect(client).toBeDefined();
      expect(client.getProxyInfo()).not.toBeNull();
    });

    it("should accept ProxyConfig object option", () => {
      const client = new MiawClient({
        instanceId: "test-proxy",
        proxy: {
          url: "http://proxy.example.com:8080",
          username: "user",
          password: "pass",
        },
      });

      expect(client).toBeDefined();
      expect(client.getProxyInfo()).not.toBeNull();
    });

    it("should accept custom agent option", () => {
      // Create a minimal mock agent
      const mockAgent = { destroy: jest.fn() } as unknown as Agent;

      const client = new MiawClient({
        instanceId: "test-agent",
        agent: mockAgent,
      });

      expect(client).toBeDefined();
    });

    it("should accept custom fetchAgent option", () => {
      const mockFetchAgent = { destroy: jest.fn() };

      const client = new MiawClient({
        instanceId: "test-fetch-agent",
        fetchAgent: mockFetchAgent,
      });

      expect(client).toBeDefined();
    });

    it("should work without proxy (backward compatibility)", () => {
      const client = new MiawClient({
        instanceId: "test-no-proxy",
      });

      expect(client).toBeDefined();
      expect(client.getProxyInfo()).toBeNull();
    });
  });

  describe("getProxyInfo", () => {
    it("should return null when no proxy is configured", () => {
      const client = new MiawClient({
        instanceId: "test-no-proxy",
      });

      expect(client.getProxyInfo()).toBeNull();
    });

    it("should return url and protocol for string proxy", () => {
      const client = new MiawClient({
        instanceId: "test-proxy",
        proxy: "socks5://proxy.example.com:1080",
      });

      const info = client.getProxyInfo();
      expect(info).not.toBeNull();
      expect(info!.protocol).toBe("socks5");
      expect(info!.url).toContain("proxy.example.com");
      expect(info!.url).toContain("1080");
    });

    it("should return url and protocol for HTTP proxy", () => {
      const client = new MiawClient({
        instanceId: "test-proxy",
        proxy: "http://proxy.example.com:8080",
      });

      const info = client.getProxyInfo();
      expect(info).not.toBeNull();
      expect(info!.protocol).toBe("http");
    });

    it("should return url and protocol for ProxyConfig object", () => {
      const client = new MiawClient({
        instanceId: "test-proxy",
        proxy: { url: "https://proxy.example.com:443" },
      });

      const info = client.getProxyInfo();
      expect(info).not.toBeNull();
      expect(info!.protocol).toBe("https");
      expect(info!.url).toContain("proxy.example.com");
    });

    it("should mask password in proxy URL", () => {
      const client = new MiawClient({
        instanceId: "test-proxy",
        proxy: "socks5://user:secretpassword@proxy.example.com:1080",
      });

      const info = client.getProxyInfo();
      expect(info).not.toBeNull();
      expect(info!.url).not.toContain("secretpassword");
      expect(info!.url).toContain("****");
      expect(info!.url).toContain("user");
    });

    it("should mask password from ProxyConfig URL", () => {
      const client = new MiawClient({
        instanceId: "test-proxy",
        proxy: {
          url: "http://admin:topsecret@proxy.example.com:8080",
        },
      });

      const info = client.getProxyInfo();
      expect(info).not.toBeNull();
      expect(info!.url).not.toContain("topsecret");
      expect(info!.url).toContain("****");
    });

    it("should handle proxy URL without password", () => {
      const client = new MiawClient({
        instanceId: "test-proxy",
        proxy: "http://proxy.example.com:8080",
      });

      const info = client.getProxyInfo();
      expect(info).not.toBeNull();
      expect(info!.url).not.toContain("****");
      expect(info!.protocol).toBe("http");
    });
  });
});

describe("MiawClient.setProxy", () => {
  const SECRET = "s3cretpassword";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const client = (options: Record<string, unknown> = {}) =>
    new MiawClient({ instanceId: "test-set-proxy", ...options } as never);

  describe("staging a proxy", () => {
    it("should accept a valid URL string", () => {
      const c = client();
      const result = c.setProxy("socks5://new.example.com:1080");
      expect(result.success).toBe(true);
      expect(c.getProxyInfo()?.url).toBe("socks5://new.example.com:1080");
    });

    it("should replace an existing proxy", () => {
      const c = client({ proxy: "socks5://old.example.com:1080" });
      c.setProxy("socks5://new.example.com:1080");
      expect(c.getProxyInfo()?.url).toBe("socks5://new.example.com:1080");
    });

    it("should accept a ProxyConfig object and mask the password", () => {
      const c = client();
      const result = c.setProxy({
        url: "http://proxy.example.com:8080",
        username: "user",
        password: SECRET,
      });
      expect(result.success).toBe(true);
      expect(result.proxy).not.toContain(SECRET);
      expect(result.proxy).toContain("proxy.example.com");
    });

    it("should report reconnectRequired false while disconnected", () => {
      expect(client().setProxy("socks5://a.example.com:1080").reconnectRequired).toBe(false);
    });

    it("should clear the proxy on null", () => {
      const c = client({ proxy: "socks5://old.example.com:1080" });
      expect(c.setProxy(null).success).toBe(true);
      expect(c.getProxyInfo()).toBeNull();
    });

    it("should clear the proxy on undefined", () => {
      const c = client({ proxy: "socks5://old.example.com:1080" });
      expect(c.setProxy(undefined).success).toBe(true);
      expect(c.getProxyInfo()).toBeNull();
    });
  });

  describe("eager validation", () => {
    // Left to connect(), an invalid proxy throws inside a catch that turns it
    // into an `error` event, and scheduleReconnect() then retries forever.
    it("should reject an unparseable URL", () => {
      const result = client().setProxy("not-a-url");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid proxy configuration");
    });

    it("should reject an unsupported protocol", () => {
      expect(client().setProxy("ftp://proxy.example.com:21").success).toBe(false);
    });

    it("should leave the previous proxy untouched on rejection", () => {
      const c = client({ proxy: "socks5://old.example.com:1080" });
      c.setProxy("ftp://bad.example.com:21");
      expect(c.getProxyInfo()?.url).toBe("socks5://old.example.com:1080");
    });

    it("should not leak the password in the error", () => {
      const result = client().setProxy(`ftp://user:${SECRET}@bad.example.com:21`);
      expect(result.success).toBe(false);
      expect(result.error).not.toContain(SECRET);
    });

    it("should report reconnectRequired false on rejection", () => {
      expect(client().setProxy("not-a-url").reconnectRequired).toBe(false);
    });
  });

  describe("custom agent precedence", () => {
    // resolveProxyAgents() early-returns on a custom agent, so accepting the
    // call would be a silent no-op - the worst possible outcome.
    it("should refuse when constructed with an agent", () => {
      const c = client({ agent: {} as Agent });
      const result = c.setProxy("socks5://new.example.com:1080");
      expect(result.success).toBe(false);
      expect(result.error).toContain("agent");
    });

    it("should refuse when constructed with a fetchAgent", () => {
      expect(client({ fetchAgent: {} }).setProxy("socks5://a.example.com:1080").success).toBe(
        false
      );
    });

    it("should not mutate the config when refusing", () => {
      const c = client({ proxy: "socks5://old.example.com:1080", agent: {} as Agent });
      c.setProxy("socks5://new.example.com:1080");
      expect(c.getProxyInfo()?.url).toBe("socks5://old.example.com:1080");
    });
  });

  describe("getProxyInfo liveness", () => {
    it("should report active false before connect()", () => {
      const info = client({ proxy: "socks5://a.example.com:1080" }).getProxyInfo();
      expect(info?.active).toBe(false);
    });

    it("should not set pending when no socket is open", () => {
      const c = client({ proxy: "socks5://a.example.com:1080" });
      c.setProxy("socks5://b.example.com:1080");
      expect(c.getProxyInfo()?.pending).toBeUndefined();
    });

    it("should still return null for a custom agent", () => {
      // Documented contract: null means "no miaw-core-managed proxy".
      expect(client({ agent: {} as Agent }).getProxyInfo()).toBeNull();
    });
  });
});

/**
 * Regression coverage for client reuse across disconnect() -> connect(), the
 * pattern the dead-proxy failover recipe depends on.
 *
 * Baileys' end() emits connection.update{connection:"close"} (verified in
 * lib/Socket/socket.js), so an explicit disconnect() lands in handleDisconnect()
 * as though the connection had dropped. The measured consequence is a DUPLICATE
 * `disconnected` event - reason "unknown" from handleDisconnect(), then
 * "intentional" from disconnect() itself.
 *
 * A second socket was NOT observed: disconnect() passes end(undefined), so the
 * reconnect path does not actually fire here. The no-reconnect assertion below
 * therefore locks in an invariant rather than covering a reproduced bug - worth
 * keeping, because the failover recipe depends on disconnect() staying inert
 * and a future Baileys change could make end() supply an error.
 */
describe("MiawClient explicit disconnect", () => {
  /** Minimal Baileys socket whose end() emits close, exactly as the real one does. */
  function makeFakeSocket() {
    const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
    const ev = {
      on: (event: string, fn: (...args: unknown[]) => void) => {
        handlers.set(event, [...(handlers.get(event) ?? []), fn]);
      },
      removeAllListeners: (event: string) => handlers.delete(event),
      emit: (event: string, payload: unknown) => {
        for (const fn of handlers.get(event) ?? []) fn(payload);
      },
    };
    return {
      ev,
      user: { id: "1@s.whatsapp.net" },
      ws: { close: jest.fn() },
      end: jest.fn(() => {
        // The behaviour under test.
        ev.emit("connection.update", { connection: "close", lastDisconnect: {} });
      }),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    (baileys.useMultiFileAuthState as jest.Mock).mockResolvedValue({
      state: { creds: { registered: true }, keys: {} },
      saveCreds: jest.fn(),
    } as never);
    (baileys.makeCacheableSignalKeyStore as jest.Mock).mockReturnValue({} as never);
    // MiawClient.ts:1 imports makeWASocket as the DEFAULT export, so that is the
    // mock that actually gets invoked.
    (baileys.default as jest.Mock).mockImplementation(() => makeFakeSocket() as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Invariant, not a reproduced regression - see the note above.
  it("should not reconnect after an explicit disconnect", async () => {
    const client = new MiawClient({
      instanceId: "test-disconnect",
      sessionPath: "/tmp/miaw-unit-does-not-exist",
      proxy: "socks5://a.example.com:1080",
      reconnectDelay: 100,
    });

    await client.connect();
    expect(baileys.default).toHaveBeenCalledTimes(1);

    await client.disconnect();

    // Well past reconnectDelay and several backoff multiples.
    await jest.advanceTimersByTimeAsync(100 * 40);

    expect(baileys.default).toHaveBeenCalledTimes(1);
  });

  it("should emit disconnected exactly once, as intentional", async () => {
    const client = new MiawClient({
      instanceId: "test-disconnect-event",
      sessionPath: "/tmp/miaw-unit-does-not-exist",
      reconnectDelay: 100,
    });

    const reasons: unknown[] = [];
    client.on("disconnected", (reason: unknown) => reasons.push(reason));

    await client.connect();
    await client.disconnect();
    await jest.advanceTimersByTimeAsync(100 * 40);

    expect(reasons).toEqual(["intentional"]);
  });

  it("should pick up a setProxy() value on the next connect", async () => {
    const client = new MiawClient({
      instanceId: "test-reuse",
      sessionPath: "/tmp/miaw-unit-does-not-exist",
      proxy: "socks5://old.example.com:1080",
      reconnectDelay: 100,
    });

    await client.connect();
    await client.disconnect();

    expect(client.setProxy("socks5://new.example.com:1080").success).toBe(true);
    await client.connect();

    expect(baileys.default).toHaveBeenCalledTimes(2);
    expect(client.getProxyInfo()?.url).toBe("socks5://new.example.com:1080");
    // The socket is live and was built from this config.
    expect(client.getProxyInfo()?.active).toBe(true);
  });

  it("should keep user event handlers across the cycle", async () => {
    // disconnect() must not removeAllListeners() - only the terminal dispose()
    // does that - or the reconnected client would be deaf.
    const client = new MiawClient({
      instanceId: "test-handlers",
      sessionPath: "/tmp/miaw-unit-does-not-exist",
      reconnectDelay: 100,
    });

    const onReady = jest.fn();
    client.on("ready", onReady);

    await client.connect();
    await client.disconnect();
    await client.connect();

    expect(client.listenerCount("ready")).toBe(1);
  });
});
