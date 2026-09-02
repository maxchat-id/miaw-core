/**
 * CLI Integration Tests: Per-Instance Proxy Pins
 *
 * Like 11-proxy-commands.test.ts and unlike every other file here, these tests
 * need NO WhatsApp connection and no .env.test credentials: `instance
 * set-proxy` / `unset-proxy` / `ls` all dispatch before getOrCreateClient() is
 * ever reached, so this file runs green in CI on a machine that has never
 * paired a device.
 *
 * They use a private temp session path rather than cli-setup's shared
 * clientConfig, so writing pins here cannot disturb the real session directory
 * that the connection-dependent files share.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runCommand } from "../../../src/cli/commands/index.js";
import { getCacheStats } from "../../../src/cli/utils/client-cache.js";
import { captureConsole } from "./cli-setup.js";

const PROXY_TXT = path.join("tests/fixtures", "proxies.txt");

/** The password planted in the fixtures. It must never reach any output. */
const FIXTURE_SECRET = "s3cretpassword";

/** A password typed on the command line. Also must never be echoed. */
const TYPED_SECRET = "typeds3cret";

describe("CLI: instance proxy pins", () => {
  let sessionPath: string;

  /** Runs an `instance` subcommand against the private session path. */
  async function run(
    args: string[],
    options?: { flags?: { [key: string]: string | boolean }; jsonOutput?: boolean }
  ): Promise<{ ok: boolean; output: string }> {
    const capture = captureConsole();
    try {
      const result = await runCommand("instance", args, {
        clientConfig: { instanceId: "default", sessionPath },
        jsonOutput: options?.jsonOutput ?? false,
        ...(options?.flags && { flags: options.flags }),
      });
      return { ok: result === true, output: capture.getFullOutput() };
    } finally {
      capture.stop();
    }
  }

  const configPath = (): string => path.join(sessionPath, "instances.json");
  const readConfig = (): string => fs.readFileSync(configPath(), "utf-8");

  beforeEach(() => {
    sessionPath = fs.mkdtempSync(path.join(os.tmpdir(), "miaw-cli-pins-"));
  });

  afterEach(() => {
    fs.rmSync(sessionPath, { recursive: true, force: true });
  });

  describe("dispatch", () => {
    it("should list the new subcommands in its usage", async () => {
      const { ok, output } = await run(["nonsense"]);
      expect(ok).toBe(false);
      expect(output).toContain("Unknown instance command");
      expect(output).toContain("set-proxy");
      expect(output).toContain("unset-proxy");
    });

    it("should print usage for set-proxy with no instance id", async () => {
      const { ok, output } = await run(["set-proxy"]);
      expect(ok).toBe(false);
      expect(output).toContain("Usage: miaw-cli instance set-proxy");
    });

    it("should print usage for unset-proxy with no instance id", async () => {
      const { ok, output } = await run(["unset-proxy"]);
      expect(ok).toBe(false);
      expect(output).toContain("Usage: miaw-cli instance unset-proxy");
    });

    it("should not construct a client", async () => {
      // The regression guard: these must dispatch above getOrCreateClient().
      const before = getCacheStats().size;
      await run(["set-proxy", "bot-3", "socks5://127.0.0.1:1080"]);
      await run(["ls"]);
      await run(["unset-proxy", "bot-3"]);
      expect(getCacheStats().size).toBe(before);
    });

    it("should not create a session directory for the instance", async () => {
      await run(["set-proxy", "bot-3", "socks5://127.0.0.1:1080"]);
      expect(fs.existsSync(path.join(sessionPath, "bot-3"))).toBe(false);
    });
  });

  describe("set-proxy", () => {
    it("should pin a url and report it masked", async () => {
      const { ok, output } = await run([
        "set-proxy",
        "bot-3",
        `socks5://user:${TYPED_SECRET}@127.0.0.1:1080`,
      ]);
      expect(ok).toBe(true);
      expect(output).toContain("Pinned");
      expect(output).toContain("127.0.0.1:1080");
      expect(output).not.toContain(TYPED_SECRET);
    });

    it("should say the pin applies on the next connect", async () => {
      const { output } = await run(["set-proxy", "bot-3", "socks5://127.0.0.1:1080"]);
      expect(output).toContain("NEXT connect");
    });

    it("should suggest --from-env when a password is typed inline", async () => {
      const { output } = await run([
        "set-proxy",
        "bot-3",
        `socks5://user:${TYPED_SECRET}@127.0.0.1:1080`,
      ]);
      expect(output).toContain("--from-env");
    });

    it("should not suggest --from-env for a credential-free url", async () => {
      const { output } = await run(["set-proxy", "bot-3", "socks5://127.0.0.1:1080"]);
      expect(output).not.toContain("--from-env VAR or --label");
    });

    it("should reject an unsupported protocol and write nothing", async () => {
      const { ok, output } = await run(["set-proxy", "bot-3", "ftp://127.0.0.1:21"]);
      expect(ok).toBe(false);
      expect(output).toContain("Invalid proxy configuration");
      expect(fs.existsSync(configPath())).toBe(false);
    });

    it("should reject two proxy sources at once", async () => {
      const { ok, output } = await run(["set-proxy", "bot-3", "socks5://127.0.0.1:1080", "--label", "eu"]);
      expect(ok).toBe(false);
      expect(output).toContain("exactly one proxy source");
    });

    it("should reject a set-proxy with no source at all", async () => {
      const { ok, output } = await run(["set-proxy", "bot-3"]);
      expect(ok).toBe(false);
      expect(output).toContain("Usage");
    });

    it("should overwrite an existing pin", async () => {
      await run(["set-proxy", "bot-3", "socks5://10.0.0.1:1080"]);
      await run(["set-proxy", "bot-3", "socks5://10.0.0.2:1080"]);
      expect(readConfig()).toContain("10.0.0.2");
      expect(readConfig()).not.toContain("10.0.0.1");
    });

    it("should keep instances independent", async () => {
      await run(["set-proxy", "bot-a", "socks5://10.0.0.1:1080"]);
      await run(["set-proxy", "bot-b", "socks5://10.0.0.2:1080"]);
      const parsed = JSON.parse(readConfig());
      expect(parsed.instances["bot-a"].proxy.url).toBe("socks5://10.0.0.1:1080");
      expect(parsed.instances["bot-b"].proxy.url).toBe("socks5://10.0.0.2:1080");
    });
  });

  describe("set-proxy --label", () => {
    it("should store a label and no credentials", async () => {
      const { ok } = await run(["set-proxy", "bot-3", "--label", "eu"], {
        flags: { "proxy-file": PROXY_TXT },
      });
      expect(ok).toBe(true);

      const raw = readConfig();
      expect(JSON.parse(raw).instances["bot-3"].proxy.label).toBe("eu");
      // The whole point of the label form: the eu entry in the fixture carries
      // a password, and none of it reaches disk.
      expect(raw).not.toContain(FIXTURE_SECRET);
      expect(raw).not.toContain("://");
    });

    it("should report the label rather than a url", async () => {
      const { output } = await run(["set-proxy", "bot-3", "--label", "asia"]);
      expect(output).toContain("label:asia");
    });
  });

  describe("set-proxy --from-env", () => {
    const VAR = "MIAW_TEST_PROXY_FOR_PIN";

    afterEach(() => {
      delete process.env[VAR];
    });

    it("should read the url from the environment", async () => {
      process.env[VAR] = `socks5://user:${TYPED_SECRET}@127.0.0.1:1080`;
      const { ok, output } = await run(["set-proxy", "bot-3", "--from-env", VAR]);
      expect(ok).toBe(true);
      expect(JSON.parse(readConfig()).instances["bot-3"].proxy.url).toContain("127.0.0.1:1080");
      // Sourced from the environment precisely so it stays out of history/output.
      expect(output).not.toContain(TYPED_SECRET);
    });

    it("should fail clearly when the variable is unset", async () => {
      const { ok, output } = await run(["set-proxy", "bot-3", "--from-env", VAR]);
      expect(ok).toBe(false);
      expect(output).toContain(VAR);
      expect(output).toContain("not set");
    });
  });

  describe("set-proxy --from-file", () => {
    it("should materialize the deterministic selection for this instance", async () => {
      const { ok } = await run(["set-proxy", "bot-3", "--from-file"], {
        flags: { "proxy-file": PROXY_TXT },
      });
      expect(ok).toBe(true);
      expect(JSON.parse(readConfig()).instances["bot-3"].proxy.url).toMatch(/^\w+:\/\//);
    });

    it("should fail when no proxy file is configured", async () => {
      const previous = process.env.MIAW_PROXY_FILE;
      delete process.env.MIAW_PROXY_FILE;
      try {
        const { ok, output } = await run(["set-proxy", "bot-3", "--from-file"]);
        expect(ok).toBe(false);
        expect(output).toContain("--proxy-file");
      } finally {
        if (previous !== undefined) process.env.MIAW_PROXY_FILE = previous;
      }
    });
  });

  describe("flag delivery paths", () => {
    // One-shot mode strips --flags into context.flags; the REPL leaves them in
    // the raw arg list. A flag read from only one source silently no-ops.
    it("should accept --label from context.flags (one-shot shape)", async () => {
      const { ok } = await run(["set-proxy", "bot-3"], { flags: { label: "eu" } });
      expect(ok).toBe(true);
      expect(JSON.parse(readConfig()).instances["bot-3"].proxy.label).toBe("eu");
    });

    it("should accept --label from parsedArgs (REPL shape)", async () => {
      const { ok } = await run(["set-proxy", "bot-3", "--label", "eu"]);
      expect(ok).toBe(true);
      expect(JSON.parse(readConfig()).instances["bot-3"].proxy.label).toBe("eu");
    });

    it("should accept --proxy as the url source (bin swallows it as a global)", async () => {
      const { ok } = await run(["set-proxy", "bot-3"], {
        flags: { proxy: "socks5://10.0.0.9:1080" },
      });
      expect(ok).toBe(true);
      expect(JSON.parse(readConfig()).instances["bot-3"].proxy.url).toBe("socks5://10.0.0.9:1080");
    });
  });

  describe("unset-proxy", () => {
    it("should remove a pin", async () => {
      await run(["set-proxy", "bot-3", "socks5://127.0.0.1:1080"]);
      const { ok, output } = await run(["unset-proxy", "bot-3"]);
      expect(ok).toBe(true);
      expect(output).toContain("Removed the proxy pin");
    });

    it("should report false when nothing was pinned", async () => {
      const { ok, output } = await run(["unset-proxy", "bot-3"]);
      expect(ok).toBe(false);
      expect(output).toContain("No proxy pinned");
    });

    it("should report false on a second call", async () => {
      await run(["set-proxy", "bot-3", "socks5://127.0.0.1:1080"]);
      await run(["unset-proxy", "bot-3"]);
      const { ok } = await run(["unset-proxy", "bot-3"]);
      expect(ok).toBe(false);
    });
  });

  describe("instance ls", () => {
    it("should show a pinned but uncreated instance", async () => {
      // Pinning before `instance create` is the supported workflow - you want
      // the pairing itself to come from the final egress IP.
      await run(["set-proxy", "bot-3", "socks5://127.0.0.1:1080"]);
      const { ok, output } = await run(["ls"]);
      expect(ok).toBe(true);
      expect(output).toContain("bot-3");
      expect(output).toContain("[not created]");
    });

    it("should show the proxy masked", async () => {
      await run(["set-proxy", "bot-3", `socks5://user:${TYPED_SECRET}@127.0.0.1:1080`]);
      const { output } = await run(["ls"]);
      expect(output).toContain("127.0.0.1:1080");
      expect(output).not.toContain(TYPED_SECRET);
    });

    it("should report an empty session path as having no instances", async () => {
      const { ok, output } = await run(["ls"]);
      expect(ok).toBe(true);
      expect(output).toContain("No instances found");
    });

    it("should render a label pin without reading the proxy file", async () => {
      await run(["set-proxy", "bot-3", "--label", "eu"]);
      const { output } = await run(["ls"]);
      expect(output).toContain("label:eu");
      expect(output).not.toContain(FIXTURE_SECRET);
    });
  });

  describe("instance status", () => {
    it("should accept a pinned but uncreated instance", async () => {
      // Regression: status resolved instances from session directories alone,
      // so it rejected an instance that `ls` displays. That broke the
      // documented pin-then-create workflow: you pin a proxy, then cannot ask
      // what you just pinned.
      await run(["set-proxy", "bot-3", "socks5://127.0.0.1:1080"]);
      const { ok, output } = await run(["status", "bot-3"]);
      expect(ok).toBe(true);
      expect(output).not.toContain("not found");
      expect(output).toContain("bot-3");
      expect(output).toContain("127.0.0.1:1080");
      // Same label `ls` uses, so the two commands cannot disagree.
      expect(output).toContain("[not created]");
    });

    it("should still reject an instance that is neither created nor pinned", async () => {
      const { ok, output } = await run(["status", "nonexistent"]);
      expect(ok).toBe(false);
      expect(output).toContain("not found");
    });

    it("should offer pinned instances as available ones", async () => {
      await run(["set-proxy", "bot-3", "socks5://127.0.0.1:1080"]);
      const { output } = await run(["status", "nonexistent"]);
      expect(output).toContain("Available instances:");
      expect(output).toContain("bot-3");
    });

    it("should not leak the pinned password", async () => {
      await run(["set-proxy", "bot-3", `socks5://user:${TYPED_SECRET}@127.0.0.1:1080`]);
      const { output } = await run(["status", "bot-3"]);
      expect(output).not.toContain(TYPED_SECRET);
    });
  });

  describe("corrupt config", () => {
    it("should refuse to run rather than silently connect direct", async () => {
      // Treating an unreadable pin store as "no proxy" would leak the real IP.
      fs.writeFileSync(configPath(), "{ truncated");
      const { ok, output } = await run(["ls"]);
      expect(ok).toBe(false);
      expect(output).toContain("not valid JSON");
    });
  });
});
