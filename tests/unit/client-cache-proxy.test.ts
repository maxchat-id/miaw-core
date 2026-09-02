/**
 * Unit Tests for Proxy Identity in the CLI Client Cache
 *
 * The cache key is deliberately `instanceId:sessionPath` with no proxy in it -
 * keying on proxy would let one instance hold two entries, i.e. two live
 * sockets for a single WhatsApp account. Instead the cache remembers which
 * proxy each client was built with and reacts to a mismatch.
 *
 * Offline: constructing a MiawClient opens no socket until connect().
 */

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  getOrCreateClient,
  peekClient,
  removeClient,
  getCacheStats,
  hasClient,
} from "../../src/cli/utils/client-cache.js";
import type { ClientConfig } from "../../src/cli/utils/session.js";
import type { ConnectionState } from "../../src/types/index.js";

const SECRET = "s3cretpassword";
const PROXY_A = "socks5://a.example.com:1080";
const PROXY_B = "socks5://b.example.com:1080";
const PROXY_WITH_SECRET = `http://user:${SECRET}@c.example.com:8080`;

/**
 * Force a cached client to report a given state.
 *
 * An own-property override on the instance, so it shadows the prototype method
 * without touching any other client.
 */
function stubState(client: object, state: ConnectionState): void {
  Object.defineProperty(client, "getConnectionState", {
    value: () => state,
    configurable: true,
    writable: true,
  });
}

describe("Client Cache - proxy identity", () => {
  let sessionPath: string;
  let logSpy: ReturnType<typeof jest.spyOn>;

  const cfg = (over: Partial<ClientConfig> = {}): ClientConfig => ({
    instanceId: "bot",
    sessionPath,
    ...over,
  });

  beforeEach(() => {
    sessionPath = fs.mkdtempSync(path.join(os.tmpdir(), "miaw-cache-proxy-"));
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    removeClient(cfg());
    logSpy.mockRestore();
    fs.rmSync(sessionPath, { recursive: true, force: true });
  });

  describe("matching proxy", () => {
    it("should return the same client when the proxy is unchanged", () => {
      const first = getOrCreateClient(cfg({ proxy: PROXY_A }));
      const second = getOrCreateClient(cfg({ proxy: PROXY_A }));
      expect(second).toBe(first);
    });

    it("should not warn when the proxy is unchanged", () => {
      getOrCreateClient(cfg({ proxy: PROXY_A }));
      logSpy.mockClear();
      getOrCreateClient(cfg({ proxy: PROXY_A }));
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("should treat a direct connection as a stable identity", () => {
      const first = getOrCreateClient(cfg());
      logSpy.mockClear();
      const second = getOrCreateClient(cfg());
      expect(second).toBe(first);
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("mismatch while disconnected", () => {
    it("should rebuild the client for the new proxy", () => {
      const first = getOrCreateClient(cfg({ proxy: PROXY_A }));
      stubState(first, "disconnected");
      const second = getOrCreateClient(cfg({ proxy: PROXY_B }));
      expect(second).not.toBe(first);
    });

    it("should warn that it rebuilt", () => {
      const first = getOrCreateClient(cfg({ proxy: PROXY_A }));
      stubState(first, "disconnected");
      logSpy.mockClear();
      getOrCreateClient(cfg({ proxy: PROXY_B }));
      expect(logSpy.mock.calls.flat().join("\n")).toContain("Rebuilding");
    });

    it("should rebuild when a proxy is added to a previously direct client", () => {
      const first = getOrCreateClient(cfg());
      stubState(first, "disconnected");
      const second = getOrCreateClient(cfg({ proxy: PROXY_A }));
      expect(second).not.toBe(first);
    });

    it("should rebuild when a proxy is removed", () => {
      const first = getOrCreateClient(cfg({ proxy: PROXY_A }));
      stubState(first, "disconnected");
      const second = getOrCreateClient(cfg());
      expect(second).not.toBe(first);
      expect(logSpy.mock.calls.flat().join("\n")).toContain("direct connection");
    });

    it("should record the new proxy identity after rebuilding", () => {
      const first = getOrCreateClient(cfg({ proxy: PROXY_A }));
      stubState(first, "disconnected");
      getOrCreateClient(cfg({ proxy: PROXY_B }));
      logSpy.mockClear();
      getOrCreateClient(cfg({ proxy: PROXY_B }));
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("mismatch while the socket is live", () => {
    // Dropping a live connection mid-command is worse than the stale proxy,
    // and rebuilding during pairing throws away a QR already on screen.
    const liveStates: ConnectionState[] = [
      "connected",
      "connecting",
      "reconnecting",
      "qr_required",
    ];

    for (const state of liveStates) {
      it(`should keep the cached client when ${state}`, () => {
        const first = getOrCreateClient(cfg({ proxy: PROXY_A }));
        stubState(first, state);
        const second = getOrCreateClient(cfg({ proxy: PROXY_B }));
        expect(second).toBe(first);
      });
    }

    it("should say the change applies on the next connect", () => {
      const first = getOrCreateClient(cfg({ proxy: PROXY_A }));
      stubState(first, "connected");
      logSpy.mockClear();
      getOrCreateClient(cfg({ proxy: PROXY_B }));
      expect(logSpy.mock.calls.flat().join("\n")).toContain("next connect");
    });

    it("should not rebuild inside the cache grace period either", () => {
      // The mismatch check runs before the grace-period early return, so a
      // proxy change moments after caching is still reported.
      const first = getOrCreateClient(cfg({ proxy: PROXY_A }));
      stubState(first, "connecting");
      logSpy.mockClear();
      const second = getOrCreateClient(cfg({ proxy: PROXY_B }));
      expect(second).toBe(first);
      expect(logSpy.mock.calls.flat().join("\n")).toContain("next connect");
    });
  });

  describe("cache key invariants", () => {
    it("should keep exactly one entry across a proxy change", () => {
      const first = getOrCreateClient(cfg({ proxy: PROXY_A }));
      stubState(first, "disconnected");
      getOrCreateClient(cfg({ proxy: PROXY_B }));
      expect(getCacheStats().size).toBe(1);
    });

    it("should never put a proxy URL in a cache key", () => {
      getOrCreateClient(cfg({ proxy: PROXY_A }));
      for (const key of getCacheStats().keys) {
        expect(key).not.toContain("://");
      }
    });

    it("should key on instanceId and sessionPath only", () => {
      getOrCreateClient(cfg({ proxy: PROXY_A }));
      expect(getCacheStats().keys).toEqual([`bot:${sessionPath}`]);
    });
  });

  describe("credential safety", () => {
    it("should report the proxy masked in cache stats", () => {
      getOrCreateClient(cfg({ proxy: PROXY_WITH_SECRET }));
      const stats = getCacheStats();
      expect(JSON.stringify(stats)).not.toContain(SECRET);
      expect(stats.clients[0].proxy).toContain("c.example.com");
    });

    it("should report null for a direct client", () => {
      getOrCreateClient(cfg());
      expect(getCacheStats().clients[0].proxy).toBeNull();
    });

    it("should not leak the password in a mismatch warning", () => {
      const first = getOrCreateClient(cfg({ proxy: PROXY_WITH_SECRET }));
      stubState(first, "connected");
      logSpy.mockClear();
      getOrCreateClient(cfg({ proxy: PROXY_B }));
      expect(logSpy.mock.calls.flat().join("\n")).not.toContain(SECRET);
    });
  });

  describe("peekClient", () => {
    it("should return null when nothing is cached", () => {
      expect(peekClient(cfg())).toBeNull();
    });

    it("should return the cached client", () => {
      const client = getOrCreateClient(cfg({ proxy: PROXY_A }));
      expect(peekClient(cfg({ proxy: PROXY_A }))).toBe(client);
    });

    it("should not warn or rebuild on a proxy mismatch", () => {
      const first = getOrCreateClient(cfg({ proxy: PROXY_A }));
      stubState(first, "disconnected");
      logSpy.mockClear();
      expect(peekClient(cfg({ proxy: PROXY_B }))).toBe(first);
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("should not create a client", () => {
      peekClient(cfg({ proxy: PROXY_A }));
      expect(getCacheStats().size).toBe(0);
    });
  });

  describe("removeClient", () => {
    it("should clear the proxy identity along with the entry", () => {
      getOrCreateClient(cfg({ proxy: PROXY_A }));
      removeClient(cfg());
      expect(hasClient(cfg())).toBe(false);

      // A fresh client for the same key must not inherit the old identity.
      logSpy.mockClear();
      getOrCreateClient(cfg({ proxy: PROXY_B }));
      expect(logSpy).not.toHaveBeenCalled();
    });
  });
});
