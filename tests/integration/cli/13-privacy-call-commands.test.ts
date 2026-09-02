/**
 * CLI Integration Tests: Privacy, Blocklist & Calls (v1.12.0)
 *
 * Read-only and self-restoring only. The privacy setters and the blocklist
 * change account-wide state that outlives the test run, so the mutating paths
 * here either restore what they found or are left to the manual runner:
 *
 *   - `privacy show` and `block list` are pure reads.
 *   - `privacy set` is exercised by reading the current value first and writing
 *     the SAME value back, which proves the round-trip without changing
 *     anything.
 *   - `block add` / `block remove` are NOT exercised: blocking a real contact
 *     is visible to that contact, and a failed restore would leave them blocked.
 *   - `call link` is a read-ish create, but it mints a real shareable link, so
 *     it is only run when explicitly opted into via TEST_CALL_LINK=1.
 *
 * This is the last file that needs a connection, so it owns teardown.
 */

import {
  setupCLITests,
  teardownCLITests,
  isConnected,
  runCmd,
  captureConsole,
  CLI_TEST_CONFIG,
} from "./cli-setup.js";

beforeAll(async () => {
  await setupCLITests();
}, CLI_TEST_CONFIG.connectTimeout + 10000);

afterAll(async () => {
  await teardownCLITests();
});

describe("CLI Privacy Commands", () => {
  test("privacy show returns true", async () => {
    if (!isConnected()) {
      console.log("⏭️  Skipping: not connected");
      return;
    }
    const result = await runCmd("privacy", ["show"]);
    expect(result).toBe(true);
  });

  test("privacy (no subcommand) defaults to show", async () => {
    if (!isConnected()) {
      console.log("⏭️  Skipping: not connected");
      return;
    }
    const result = await runCmd("privacy", []);
    expect(result).toBe(true);
  });

  test("privacy show --json emits parseable JSON", async () => {
    if (!isConnected()) {
      console.log("⏭️  Skipping: not connected");
      return;
    }
    const capture = captureConsole();
    try {
      const result = await runCmd("privacy", ["show"], { jsonOutput: true });
      expect(result).toBe(true);
      const parsed = JSON.parse(capture.getFullOutput());
      // `raw` is the one field always present -- every other key is optional
      // because WhatsApp omits categories it has no value for.
      expect(parsed).toHaveProperty("raw");
    } finally {
      capture.stop();
    }
  });

  test("privacy show --force re-queries and still returns true", async () => {
    if (!isConnected()) {
      console.log("⏭️  Skipping: not connected");
      return;
    }
    const result = await runCmd("privacy", ["show", "--force"]);
    expect(result).toBe(true);
  });

  test("privacy set round-trips the current value unchanged", async () => {
    if (!isConnected()) {
      console.log("⏭️  Skipping: not connected");
      return;
    }

    // Read the current setting, then write the same value back. This exercises
    // the full set path without leaving the account in a different state.
    const capture = captureConsole();
    let current: string | undefined;
    try {
      await runCmd("privacy", ["show"], { jsonOutput: true });
      current = JSON.parse(capture.getFullOutput()).lastSeen;
    } finally {
      capture.stop();
    }

    if (!current) {
      console.log("⏭️  Skipping: WhatsApp did not report a last-seen setting");
      return;
    }

    const result = await runCmd("privacy", ["set", "last-seen", current]);
    expect(result).toBe(true);
  });
});

describe("CLI Blocklist Commands", () => {
  test("block list returns true", async () => {
    if (!isConnected()) {
      console.log("⏭️  Skipping: not connected");
      return;
    }
    const result = await runCmd("block", ["list"]);
    expect(result).toBe(true);
  });

  test("block ls (alias) returns true", async () => {
    if (!isConnected()) {
      console.log("⏭️  Skipping: not connected");
      return;
    }
    const result = await runCmd("block", ["ls"]);
    expect(result).toBe(true);
  });

  test("block list --json emits a parseable array", async () => {
    if (!isConnected()) {
      console.log("⏭️  Skipping: not connected");
      return;
    }
    const capture = captureConsole();
    try {
      const result = await runCmd("block", ["list"], { jsonOutput: true });
      expect(result).toBe(true);
      expect(Array.isArray(JSON.parse(capture.getFullOutput()))).toBe(true);
    } finally {
      capture.stop();
    }
  });
});

describe("CLI Call Commands", () => {
  // Minting a call link creates a real shareable artifact, so this stays opt-in.
  const optedIn = process.env.TEST_CALL_LINK === "1";

  (optedIn ? test : test.skip)(
    "call link video returns a link (TEST_CALL_LINK=1)",
    async () => {
      if (!isConnected()) {
        console.log("⏭️  Skipping: not connected");
        return;
      }
      const capture = captureConsole();
      try {
        const result = await runCmd("call", ["link", "video"]);
        expect(result).toBe(true);
        expect(capture.getFullOutput()).toContain("call.whatsapp.com");
      } finally {
        capture.stop();
      }
    }
  );
});

describe("CLI Group & Community Admin Commands", () => {
  // The settings themselves are destructive (they change a real group for every
  // member), so only the read-only join-request listing runs here. The setters
  // are covered by unit tests and by `npm run test:manual group`.
  test("group requests list returns true for a known group", async () => {
    if (!isConnected()) {
      console.log("⏭️  Skipping: not connected");
      return;
    }
    if (!CLI_TEST_CONFIG.groupJid) {
      console.log("⏭️  Skipping: TEST_GROUP_JID not configured");
      return;
    }
    const result = await runCmd("group", [
      "requests",
      "list",
      CLI_TEST_CONFIG.groupJid,
    ]);
    expect(result).toBe(true);
  });

  test("group requests list --json emits a parseable array", async () => {
    if (!isConnected()) {
      console.log("⏭️  Skipping: not connected");
      return;
    }
    if (!CLI_TEST_CONFIG.groupJid) {
      console.log("⏭️  Skipping: TEST_GROUP_JID not configured");
      return;
    }
    const capture = captureConsole();
    try {
      const result = await runCmd(
        "group",
        ["requests", "list", CLI_TEST_CONFIG.groupJid],
        { jsonOutput: true }
      );
      expect(result).toBe(true);
      expect(Array.isArray(JSON.parse(capture.getFullOutput()))).toBe(true);
    } finally {
      capture.stop();
    }
  });
});
