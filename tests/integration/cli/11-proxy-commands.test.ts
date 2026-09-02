/**
 * CLI Integration Tests: Proxy Commands
 *
 * Unlike every other file in this directory, these tests need NO WhatsApp
 * connection and no .env.test credentials. The `proxy` dispatch block in
 * runCommand() returns before getOrCreateClient() is ever called, so this
 * file runs green in CI on a machine that has never paired a device.
 *
 * They are also fully offline: unreachable proxies point at closed
 * loopback ports, which ECONNREFUSE immediately rather than waiting out a
 * network timeout.
 */

import { describe, it, expect } from "@jest/globals";
import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as path from "node:path";
import { runCmd, captureConsole } from "./cli-setup.js";

const FIXTURES = "tests/fixtures";
const PROXY_TXT = path.join(FIXTURES, "proxies.txt");
const PROXY_JSON = path.join(FIXTURES, "proxies.json");
const PROXY_UNREACHABLE = path.join(FIXTURES, "proxies-unreachable.txt");
const PROXY_VENDOR = path.join(FIXTURES, "proxies-vendor.txt");

/** The password planted in the fixtures. It must never reach any output. */
const FIXTURE_SECRET = "s3cretpassword";

/**
 * Runs a proxy command and returns its exit boolean plus captured stdout.
 */
/**
 * Runs `fn` with MIAW_PROXY_FILE unset.
 *
 * `--proxy-file` falls back to that variable, and it is a documented setting
 * an operator is encouraged to have exported - so without this, the two tests
 * covering the "no proxy file configured" path fail on exactly the machines
 * that use the feature, and pass in CI.
 */
async function withoutAmbientProxyFile<T>(fn: () => Promise<T>): Promise<T> {
  const saved = process.env.MIAW_PROXY_FILE;
  delete process.env.MIAW_PROXY_FILE;
  try {
    return await fn();
  } finally {
    if (saved !== undefined) process.env.MIAW_PROXY_FILE = saved;
  }
}

async function run(
  args: string[],
  options?: { jsonOutput?: boolean; flags?: { [key: string]: string | boolean } }
): Promise<{ ok: boolean; output: string }> {
  const capture = captureConsole();
  try {
    const result = await runCmd("proxy", args, options);
    return {
      ok: result === true,
      output: capture.getFullOutput(),
    };
  } finally {
    capture.stop();
  }
}

describe("CLI: proxy commands", () => {
  describe("dispatch", () => {
    it("should print usage for a bare `proxy`", async () => {
      const { ok, output } = await run([]);
      expect(ok).toBe(false);
      expect(output).toContain("Usage: proxy");
      expect(output).toContain("list, test, test-all");
    });

    it("should reject an unknown subcommand", async () => {
      const { ok, output } = await run(["foobar"]);
      expect(ok).toBe(false);
      expect(output).toContain("Unknown proxy command");
    });

    it("should not create a client or session directory", async () => {
      // The regression guard: `proxy` must dispatch above getOrCreateClient().
      const sessionPath = path.resolve("./test-sessions");
      const existedBefore = fs.existsSync(sessionPath);

      await run(["list"], { flags: { "proxy-file": PROXY_TXT } });

      if (!existedBefore) {
        expect(fs.existsSync(sessionPath)).toBe(false);
      }
    });
  });

  describe("proxy list", () => {
    it("should require a proxy file", async () => {
      const { ok, output } = await withoutAmbientProxyFile(() =>
        run(["list"])
      );
      expect(ok).toBe(false);
      expect(output).toContain("--proxy-file");
    });

    it("should list proxies from a .txt file", async () => {
      const { ok, output } = await run(["list"], {
        flags: { "proxy-file": PROXY_TXT },
      });
      expect(ok).toBe(true);
      expect(output).toContain("us1.example.com");
      expect(output).toContain("eu1.example.com");
      expect(output).toContain("proxies loaded");
    });

    it("should NEVER print the password", async () => {
      // The single most important assertion in this file.
      const { output } = await run(["list"], {
        flags: { "proxy-file": PROXY_TXT },
      });
      expect(output).not.toContain(FIXTURE_SECRET);
      expect(output).toContain("****");
    });

    it("should accept `ls` as an alias", async () => {
      const { ok } = await run(["ls"], { flags: { "proxy-file": PROXY_TXT } });
      expect(ok).toBe(true);
    });

    it("should report skipped invalid entries without failing", async () => {
      const { ok, output } = await run(["list"], {
        flags: { "proxy-file": PROXY_TXT },
      });
      expect(ok).toBe(true);
      expect(output).toContain("invalid entry skipped");
      expect(output).toContain("ftp:");
    });

    it("should warn that SOCKS proxies leave media on a direct connection", async () => {
      const { output } = await run(["list"], {
        flags: { "proxy-file": PROXY_TXT },
      });
      expect(output).toContain("media DOWNLOADS use a direct connection");
    });

    it("should emit a well-formed --json payload", async () => {
      const { ok, output } = await run(["list"], {
        jsonOutput: true,
        flags: { "proxy-file": PROXY_TXT },
      });
      expect(ok).toBe(true);

      const payload = JSON.parse(output);
      expect(payload.format).toBe("txt");
      expect(payload.count).toBe(5);
      expect(payload.byProtocol).toEqual({ socks5: 2, http: 2, https: 1 });
      expect(payload.errors).toHaveLength(1);
      expect(payload.errors[0].line).toBe(18);

      const authed = payload.proxies.find(
        (p: { hasAuth: boolean }) => p.hasAuth
      );
      expect(authed.url).toContain("****");
      expect(authed.url).not.toContain(FIXTURE_SECRET);
      expect(output).not.toContain(FIXTURE_SECRET);
    });

    it("should carry weight and label through to --json", async () => {
      const { output } = await run(["list"], {
        jsonOutput: true,
        flags: { "proxy-file": PROXY_TXT },
      });
      const payload = JSON.parse(output);
      const us1 = payload.proxies.find(
        (p: { host: string }) => p.host === "us1.example.com"
      );
      expect(us1.weight).toBe(3);
      expect(us1.label).toBe("us");
      expect(us1.downloadProxied).toBe(false);
    });

    it("should load a .json file and mask its credentials", async () => {
      const { ok, output } = await run(["list"], {
        jsonOutput: true,
        flags: { "proxy-file": PROXY_JSON },
      });
      expect(ok).toBe(true);

      const payload = JSON.parse(output);
      expect(payload.format).toBe("json");
      expect(payload.count).toBe(3);
      expect(output).not.toContain(FIXTURE_SECRET);
    });

    it("should fail clearly for a missing file", async () => {
      const { ok, output } = await run(["list"], {
        flags: { "proxy-file": "./definitely-does-not-exist.txt" },
      });
      expect(ok).toBe(false);
      expect(output).toContain("not found or unreadable");
      expect(output).toContain("definitely-does-not-exist.txt");
    });
  });

  describe("proxy test", () => {
    it("should require a URL", async () => {
      const { ok, output } = await run(["test"]);
      expect(ok).toBe(false);
      expect(output).toContain("Usage: miaw-cli proxy test");
    });

    it("should reject an unsupported protocol without opening a socket", async () => {
      const start = Date.now();
      const { ok, output } = await run(["test", "ftp://x.example.com:21"]);
      const elapsed = Date.now() - start;

      expect(ok).toBe(false);
      expect(output).toContain("Unsupported proxy protocol");
      // No DNS lookup, no connect: this must be effectively instant.
      expect(elapsed).toBeLessThan(500);
    });

    it("should report ECONNREFUSED for a closed port", async () => {
      const { ok, output } = await run(["test", "http://127.0.0.1:1"], {
        jsonOutput: true,
      });
      expect(ok).toBe(false);

      const payload = JSON.parse(output);
      expect(payload.ok).toBe(false);
      expect(payload.error.code).toBe("ECONNREFUSED");
      expect(payload.latencyMs).toBeNull();
      expect(payload.target).toBe("https://web.whatsapp.com/");
    });

    it("should mark SOCKS proxies as download-unproxied (uploads ARE proxied)", async () => {
      const { output } = await run(["test", "socks5://127.0.0.1:1"], {
        jsonOutput: true,
      });
      const payload = JSON.parse(output);
      expect(payload.protocol).toBe("socks5");
      expect(payload.downloadProxied).toBe(false);
    });

    it("should mark HTTP proxies as download-proxied", async () => {
      const { output } = await run(["test", "http://127.0.0.1:1"], {
        jsonOutput: true,
      });
      expect(JSON.parse(output).downloadProxied).toBe(true);
    });

    it("should mask credentials in the result", async () => {
      const { output } = await run(
        ["test", `http://user:${FIXTURE_SECRET}@127.0.0.1:1`],
        { jsonOutput: true }
      );
      expect(output).not.toContain(FIXTURE_SECRET);
      expect(JSON.parse(output).url).toContain("****");
    });

    it("should treat a 407 from the proxy as FAILURE, not success", async () => {
      // Regression: a 407 comes from the proxy itself, meaning the tunnel was
      // refused and nothing reached the target. Reporting it as reachable made
      // `proxy test-all` green-light proxy lists with wrong credentials.
      //
      // Self-contained: this proxy always rejects, so the test stays offline
      // and never has to reach the real target.
      const proxy = http.createServer();
      proxy.on("connect", (_req, socket: net.Socket) => {
        socket.write(
          "HTTP/1.1 407 Proxy Authentication Required\r\n" +
            'Proxy-Authenticate: Basic realm="test"\r\n\r\n'
        );
        socket.destroy();
      });

      await new Promise<void>((resolve) =>
        proxy.listen(0, "127.0.0.1", resolve)
      );
      const { port } = proxy.address() as net.AddressInfo;

      try {
        const { ok, output } = await run(
          ["test", `http://wrong:creds@127.0.0.1:${port}`],
          { jsonOutput: true }
        );

        expect(ok).toBe(false);

        const payload = JSON.parse(output);
        expect(payload.ok).toBe(false);
        expect(payload.status).toBe(407);
        expect(payload.error.code).toBe("EPROXYAUTH");
        expect(payload.exitIp).toBeNull();
        expect(output).not.toContain("creds");
      } finally {
        await new Promise<void>((resolve) => proxy.close(() => resolve()));
      }
    }, 20000);

    it("should explain an unparseable CONNECT rejection", async () => {
      // Several vendors (Webshare among them) reject bad credentials by
      // writing a response and slamming the socket shut. Node's parser
      // surfaces that as "HPE_CLOSED_CONNECTION - Parse Error: Data after
      // `Connection: close`", which names the parser's problem and not the
      // operator's. The raw code is kept; a hint is appended.
      const proxy = http.createServer();
      proxy.on("connect", (_req, socket: net.Socket) => {
        socket.write(
          "HTTP/1.1 407 Proxy Authentication Required\r\n" +
            "Connection: close\r\n\r\nDenied by proxy\n"
        );
        socket.destroy();
      });

      await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
      const { port } = proxy.address() as net.AddressInfo;

      try {
        const { ok, output } = await run(
          ["test", `http://wrong:${FIXTURE_SECRET}@127.0.0.1:${port}`],
          { jsonOutput: true }
        );

        expect(ok).toBe(false);
        const payload = JSON.parse(output);
        expect(payload.error.code).toBe("HPE_CLOSED_CONNECTION");
        expect(payload.error.message).toContain("credentials");
        expect(output).not.toContain(FIXTURE_SECRET);
      } finally {
        await new Promise<void>((resolve) => proxy.close(() => resolve()));
      }
    }, 20000);

    it("should not redact a short password out of ordinary error prose", async () => {
      // Regression: scrub() replaced every literal occurrence of the password
      // anywhere in the message, so the one-character password "p" turned
      // "before receiving CONNECT response" into "... res****onse".
      const proxy = http.createServer();
      proxy.on("connect", (_req, socket: net.Socket) => socket.destroy());

      await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
      const { port } = proxy.address() as net.AddressInfo;

      try {
        const { output } = await run(["test", `http://u:p@127.0.0.1:${port}`], {
          jsonOutput: true,
        });
        expect(JSON.parse(output).error.message).toContain("response");
      } finally {
        await new Promise<void>((resolve) => proxy.close(() => resolve()));
      }
    }, 20000);

    it("should still redact a real-length password from error prose", async () => {
      // The backstop for a library that prints the password on its own must
      // survive the fix above. "response" is 8 characters, so it is long
      // enough to be scrubbed even though it also appears in the message.
      const proxy = http.createServer();
      proxy.on("connect", (_req, socket: net.Socket) => socket.destroy());

      await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
      const { port } = proxy.address() as net.AddressInfo;

      try {
        const { output } = await run(
          ["test", `http://u:response@127.0.0.1:${port}`],
          { jsonOutput: true }
        );
        const { message } = JSON.parse(output).error;
        expect(message).toContain("****");
        expect(message).not.toContain("response");
      } finally {
        await new Promise<void>((resolve) => proxy.close(() => resolve()));
      }
    }, 20000);

    it("should honour --timeout even when the proxy host blackholes", async () => {
      // Regression: req.destroy() cannot abort a TCP connect still in flight
      // inside the agent, so a blackholed host used to hang for the OS connect
      // timeout (~75s) regardless of --timeout. 198.51.100.0/24 is TEST-NET-2,
      // reserved and unroutable, so the connect never completes.
      const start = Date.now();
      const { ok, output } = await run(
        ["test", "http://198.51.100.1:9999", "--timeout", "1200"],
        { jsonOutput: true }
      );
      const elapsed = Date.now() - start;

      expect(ok).toBe(false);
      expect(JSON.parse(output).ok).toBe(false);
      // Generous ceiling, but far below the ~75s OS connect timeout.
      expect(elapsed).toBeLessThan(15000);
    }, 30000);

    it("should read --ip and --timeout from context.flags (one-shot mode)", async () => {
      // Regression: bin/miaw-cli.ts strips every --flag before calling
      // runCommand, so one-shot mode delivers these via context.flags while the
      // REPL delivers them via parsedArgs. Reading only parsedArgs made --ip a
      // silent no-op from the command line.
      const start = Date.now();
      const { output } = await run(["test", "http://198.51.100.1:9999"], {
        jsonOutput: true,
        flags: { ip: true, timeout: "1200" },
      });
      const elapsed = Date.now() - start;

      // The timeout flag took effect, proving context.flags was consulted.
      expect(elapsed).toBeLessThan(15000);
      expect(JSON.parse(output).exitIp).toBeNull();
    }, 30000);

    // Opt-in: set TEST_PROXY_URL to exercise a real proxy end to end.
    const realProxy = process.env.TEST_PROXY_URL;
    (realProxy ? it : it.skip)(
      "should succeed against a real proxy (TEST_PROXY_URL)",
      async () => {
        const { ok, output } = await run(["test", realProxy!], {
          jsonOutput: true,
        });
        const payload = JSON.parse(output);
        expect(ok).toBe(true);
        expect(payload.ok).toBe(true);
        expect(payload.latencyMs).toBeGreaterThan(0);
      },
      30000
    );
  });

  describe("proxy test-all", () => {
    it("should require a proxy file", async () => {
      const { ok, output } = await withoutAmbientProxyFile(() =>
        run(["test-all"])
      );
      expect(ok).toBe(false);
      expect(output).toContain("--proxy-file");
    });

    it("should report every unreachable proxy and exit false", async () => {
      const start = Date.now();
      const { ok, output } = await run(["test-all"], {
        jsonOutput: true,
        flags: { "proxy-file": PROXY_UNREACHABLE },
      });
      const elapsed = Date.now() - start;

      expect(ok).toBe(false);

      const payload = JSON.parse(output);
      expect(payload.tested).toBe(3);
      expect(payload.ok).toBe(0);
      expect(payload.failed).toBe(3);
      expect(payload.medianLatencyMs).toBeNull();
      expect(payload.results).toHaveLength(3);

      // Concurrency + immediate refusal: nowhere near the 10s per-proxy timeout.
      expect(elapsed).toBeLessThan(5000);
    }, 20000);

    it("should render a human-readable table", async () => {
      const { output } = await run(["test-all"], {
        flags: { "proxy-file": PROXY_UNREACHABLE },
      });
      expect(output).toContain("FAIL");
      expect(output).toContain("0/3 proxies reachable");
    }, 20000);

    it("should identify each row by host:port, not by the masked url", async () => {
      // Regression: the Proxy column printed the full masked URL at width 40.
      // Vendors issue one long username across the whole pool, so every row
      // truncated to the same string - and since results are sorted by
      // latency, there was no way to map a row back to a proxy at all.
      const { output } = await run(["test-all"], {
        flags: { "proxy-file": PROXY_VENDOR },
      });

      expect(output).toContain("127.0.0.1:1");
      expect(output).toContain("127.0.0.1:2");
      expect(output).toContain("127.0.0.1:3");
      // The identity shown carries no credentials at all, masked or not.
      expect(output).not.toContain(FIXTURE_SECRET);
      expect(output).not.toContain("vendorpool-static-residential");
    }, 20000);

    it("should show an Exit IP column only when --ip is passed", async () => {
      // Regression: --ip is documented for test-all and probeProxy did make
      // the extra echo request per proxy, but the table had no column for the
      // result - so the flag cost a round trip per proxy and showed nothing.
      const withIp = await run(["test-all"], {
        flags: { "proxy-file": PROXY_UNREACHABLE, ip: true },
      });
      expect(withIp.output).toContain("Exit IP");

      const withoutIp = await run(["test-all"], {
        flags: { "proxy-file": PROXY_UNREACHABLE },
      });
      expect(withoutIp.output).not.toContain("Exit IP");
    }, 30000);
  });
});
