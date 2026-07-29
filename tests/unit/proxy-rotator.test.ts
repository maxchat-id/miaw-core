/**
 * Unit Tests for ProxyRotator
 *
 * Tests the four rotation strategies from src/utils/proxy-rotator.ts, with
 * particular attention to rendezvous-hash stability - the property that
 * keeps a WhatsApp session on a stable egress IP when the proxy file is
 * edited.
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ProxyRotator } from "../../src/utils/proxy-rotator.js";
import type { ProxyPoolEntry } from "../../src/utils/proxy-loader.js";

const POOL = [
  "socks5://a.example.com:1080",
  "socks5://b.example.com:1080",
  "http://c.example.com:8080",
];

describe("ProxyRotator", () => {
  describe("construction", () => {
    it("should accept a bare array of URLs", () => {
      const rotator = new ProxyRotator(POOL);
      expect(rotator.size).toBe(3);
      expect(rotator.strategy).toBe("round-robin");
    });

    it("should accept an options object", () => {
      const rotator = new ProxyRotator({ proxies: POOL, strategy: "random" });
      expect(rotator.strategy).toBe("random");
    });

    it("should throw for an empty pool", () => {
      expect(() => new ProxyRotator([])).toThrow(/at least one proxy/);
    });

    it("should throw for an invalid proxy URL", () => {
      expect(() => new ProxyRotator(["ftp://bad.example.com:21"])).toThrow(
        /Invalid proxy in pool/
      );
    });

    it("should throw for a negative weight", () => {
      expect(
        () => new ProxyRotator([{ url: "http://a.example.com:8080", weight: -1 }])
      ).toThrow(/must be a finite number >= 0/);
    });

    it("should throw for a NaN weight", () => {
      expect(
        () => new ProxyRotator([{ url: "http://a.example.com:8080", weight: NaN }])
      ).toThrow(/must be a finite number >= 0/);
    });

    it("should throw when the weighted strategy has no eligible proxy", () => {
      expect(
        () =>
          new ProxyRotator({
            proxies: [{ url: "http://a.example.com:8080", weight: 0 }],
            strategy: "weighted",
          })
      ).toThrow(/at least one proxy with weight > 0/);
    });

    it("should mask credentials in construction errors", () => {
      let message = "";
      try {
        new ProxyRotator([
          { url: "http://user:s3cret@a.example.com:8080", weight: -1 },
        ]);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toContain("s3cret");
      expect(message).toContain("****");
    });
  });

  describe("round-robin", () => {
    it("should cycle through the pool and wrap", () => {
      const rotator = new ProxyRotator(POOL);
      const seen = [
        rotator.next().url,
        rotator.next().url,
        rotator.next().url,
        rotator.next().url,
      ];
      expect(seen).toEqual([POOL[0], POOL[1], POOL[2], POOL[0]]);
    });

    it("should preserve its position across setProxies", () => {
      const rotator = new ProxyRotator(POOL);
      expect(rotator.next().url).toBe(POOL[0]);
      expect(rotator.next().url).toBe(POOL[1]);

      // Hot reload with the same list must not replay from the start.
      rotator.setProxies(POOL);
      expect(rotator.next().url).toBe(POOL[2]);
    });

    it("should stay in range when the previously served proxy is gone", () => {
      const rotator = new ProxyRotator(POOL);
      rotator.next();
      rotator.next();
      rotator.next(); // last served: c

      rotator.setProxies([POOL[0], POOL[1]]);
      const next = rotator.next().url;
      expect([POOL[0], POOL[1]]).toContain(next);
    });
  });

  describe("random", () => {
    it("should only return proxies from the pool", () => {
      const rotator = new ProxyRotator({ proxies: POOL, strategy: "random" });
      for (let i = 0; i < 50; i++) {
        expect(POOL).toContain(rotator.next().url);
      }
    });

    it("should honor an injected RNG", () => {
      const rotator = new ProxyRotator({
        proxies: POOL,
        strategy: "random",
        random: () => 0.99,
      });
      expect(rotator.next().url).toBe(POOL[2]);
    });
  });

  describe("weighted", () => {
    const weighted: ProxyPoolEntry[] = [
      { url: "http://a.example.com:8080", weight: 1 },
      { url: "http://b.example.com:8080", weight: 3 },
      { url: "http://c.example.com:8080", weight: 6 },
    ];

    function pickWith(random: number): string {
      return new ProxyRotator({
        proxies: weighted,
        strategy: "weighted",
        random: () => random,
      })
        .next().url;
    }

    it("should land in each weight band", () => {
      expect(pickWith(0.05)).toBe(weighted[0].url); // 0.5 of 10 -> band [0,1)
      expect(pickWith(0.2)).toBe(weighted[1].url); //  2.0 of 10 -> band [1,4)
      expect(pickWith(0.8)).toBe(weighted[2].url); //  8.0 of 10 -> band [4,10)
    });

    it("should handle the random()===0 boundary", () => {
      expect(pickWith(0)).toBe(weighted[0].url);
    });

    it("should handle the random()->1 boundary without falling off the end", () => {
      expect(pickWith(1 - Number.EPSILON)).toBe(weighted[2].url);
    });

    it("should never select a weight-0 (drained) proxy", () => {
      const drained: ProxyPoolEntry[] = [
        { url: "http://a.example.com:8080", weight: 0 },
        { url: "http://b.example.com:8080", weight: 1 },
      ];
      for (const r of [0, 0.25, 0.5, 0.75, 1 - Number.EPSILON]) {
        const rotator = new ProxyRotator({
          proxies: drained,
          strategy: "weighted",
          random: () => r,
        });
        expect(rotator.next().url).toBe(drained[1].url);
      }
    });

    it("should default a missing weight to 1", () => {
      const rotator = new ProxyRotator({
        proxies: ["http://a.example.com:8080", "http://b.example.com:8080"],
        strategy: "weighted",
        random: () => 0.75,
      });
      expect(rotator.next().url).toBe("http://b.example.com:8080");
    });
  });

  describe("deterministic (rendezvous hashing)", () => {
    it("should return the same proxy for the same instanceId", () => {
      const rotator = new ProxyRotator(POOL);
      const first = rotator.forInstance("bot-3").url;
      for (let i = 0; i < 20; i++) {
        expect(rotator.forInstance("bot-3").url).toBe(first);
      }
    });

    it("should be independent of the order proxies appear in", () => {
      const a = new ProxyRotator(POOL);
      const b = new ProxyRotator([POOL[2], POOL[0], POOL[1]]);
      for (let i = 0; i < 100; i++) {
        const id = `bot-${i}`;
        expect(b.forInstance(id).url).toBe(a.forInstance(id).url);
      }
    });

    it("should ignore credential changes when mapping", () => {
      const withAuth = new ProxyRotator([
        "socks5://user:pw1@a.example.com:1080",
        "socks5://b.example.com:1080",
        "http://c.example.com:8080",
      ]);
      const rotated = new ProxyRotator([
        "socks5://user:pw2@a.example.com:1080",
        "socks5://b.example.com:1080",
        "http://c.example.com:8080",
      ]);
      for (let i = 0; i < 50; i++) {
        const id = `bot-${i}`;
        expect(new URL(rotated.forInstance(id).url).host).toBe(
          new URL(withAuth.forInstance(id).url).host
        );
      }
    });

    it("should distribute instances across the pool", () => {
      const rotator = new ProxyRotator(POOL);
      const counts = new Map<string, number>();
      for (let i = 0; i < 1000; i++) {
        const url = rotator.forInstance(`instance-${i}`).url;
        counts.set(url, (counts.get(url) ?? 0) + 1);
      }
      expect(counts.size).toBe(3);
      // Roughly uniform: no bucket below half or above double its fair share.
      for (const count of counts.values()) {
        expect(count).toBeGreaterThan(1000 / 3 / 2);
        expect(count).toBeLessThan((1000 / 3) * 2);
      }
    });

    it("should remap ONLY the instances on a removed proxy", () => {
      // This is the property that keeps live sessions on a stable IP when
      // the proxy file is edited. Modulo hashing would fail this outright.
      const five = [
        "socks5://p1.example.com:1080",
        "socks5://p2.example.com:1080",
        "socks5://p3.example.com:1080",
        "socks5://p4.example.com:1080",
        "socks5://p5.example.com:1080",
      ];
      const before = new ProxyRotator(five);
      const ids = Array.from({ length: 500 }, (_, i) => `bot-${i}`);
      const baseline = new Map(ids.map((id) => [id, before.forInstance(id).url]));

      const removed = five[2];
      const after = new ProxyRotator(five.filter((p) => p !== removed));

      for (const id of ids) {
        const was = baseline.get(id);
        const now = after.forInstance(id).url;
        if (was !== removed) {
          expect(now).toBe(was);
        }
      }
      // Sanity: the removed proxy actually had instances on it.
      expect([...baseline.values()].filter((u) => u === removed).length).toBeGreaterThan(0);
    });

    it("should leave most instances untouched when a proxy is added", () => {
      const four = [
        "socks5://p1.example.com:1080",
        "socks5://p2.example.com:1080",
        "socks5://p3.example.com:1080",
        "socks5://p4.example.com:1080",
      ];
      const before = new ProxyRotator(four);
      const after = new ProxyRotator([...four, "socks5://p5.example.com:1080"]);

      const ids = Array.from({ length: 500 }, (_, i) => `bot-${i}`);
      const unchanged = ids.filter(
        (id) => before.forInstance(id).url === after.forInstance(id).url
      ).length;

      // Adding 1 of 5 should move ~1/5 of instances; assert well above the
      // ~0% that modulo hashing would produce.
      expect(unchanged / ids.length).toBeGreaterThan(0.7);
    });

    it("should throw when next() is called without an instanceId", () => {
      const rotator = new ProxyRotator({
        proxies: POOL,
        strategy: "deterministic",
      });
      expect(() => rotator.next()).toThrow(/requires an instanceId/);
    });

    it("should route next(id) through the deterministic path", () => {
      const rotator = new ProxyRotator({
        proxies: POOL,
        strategy: "deterministic",
      });
      expect(rotator.next("bot-7").url).toBe(rotator.forInstance("bot-7").url);
    });

    it("should stay deterministic with duplicate URLs in the pool", () => {
      const rotator = new ProxyRotator([POOL[0], POOL[0], POOL[1]]);
      const first = rotator.forInstance("bot-1").url;
      for (let i = 0; i < 10; i++) {
        expect(rotator.forInstance("bot-1").url).toBe(first);
      }
    });
  });

  describe("getStats", () => {
    it("should report totals, eligibility and strategy", () => {
      const rotator = new ProxyRotator({
        proxies: [
          { url: "http://a.example.com:8080", weight: 2, label: "eu" },
          { url: "http://b.example.com:8080", weight: 0 },
        ],
        strategy: "round-robin",
      });
      const stats = rotator.getStats();
      expect(stats.total).toBe(2);
      expect(stats.eligible).toBe(1);
      expect(stats.strategy).toBe("round-robin");
      expect(stats.proxies[0].label).toBe("eu");
      expect(stats.proxies[1].weight).toBe(0);
    });

    it("should mask credentials", () => {
      const stats = new ProxyRotator([
        "http://user:s3cret@a.example.com:8080",
      ]).getStats();
      expect(stats.proxies[0].url).not.toContain("s3cret");
      expect(stats.proxies[0].url).toContain("****");
    });
  });

  describe("fromFile", () => {
    let dir: string;

    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "miaw-rotator-"));
    });

    afterAll(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("should build a rotator from a file", async () => {
      const file = path.join(dir, "proxies.txt");
      fs.writeFileSync(file, POOL.join("\n"));
      const rotator = await ProxyRotator.fromFile(file, {
        strategy: "deterministic",
      });
      try {
        expect(rotator.size).toBe(3);
        expect(rotator.strategy).toBe("deterministic");
      } finally {
        rotator.close();
      }
    });

    it("should hot-reload the pool when the file changes", async () => {
      const file = path.join(dir, "live.txt");
      fs.writeFileSync(file, POOL.slice(0, 2).join("\n"));

      let reloaded: ProxyPoolEntry[] | undefined;
      const rotator = await ProxyRotator.fromFile(file, {
        watch: true,
        watchInterval: 50,
        onReload: (entries) => {
          reloaded = entries;
        },
      });

      try {
        expect(rotator.size).toBe(2);
        // fs.watchFile takes its baseline stat asynchronously; writing in the
        // same tick races it and the change would never be reported.
        await new Promise((r) => setTimeout(r, 200));
        fs.writeFileSync(file, POOL.join("\n"));
        await new Promise((r) => setTimeout(r, 600));
        expect(reloaded).toHaveLength(3);
        expect(rotator.size).toBe(3);
      } finally {
        rotator.close();
      }
    });

    it("should have an idempotent close()", async () => {
      const file = path.join(dir, "closeable.txt");
      fs.writeFileSync(file, POOL.join("\n"));
      const rotator = await ProxyRotator.fromFile(file, {
        watch: true,
        watchInterval: 50,
      });
      rotator.close();
      expect(() => rotator.close()).not.toThrow();
    });

    it("should propagate a load failure", async () => {
      await expect(
        ProxyRotator.fromFile(path.join(dir, "missing.txt"))
      ).rejects.toThrow(/not found or unreadable/);
    });
  });
});
