/**
 * CLI Integration Tests: Load Commands
 *
 * Tests loading older messages from chat history.
 */

import {
  setupCLITests,
  isConnected,
  runCmd,
  captureConsole,
  CLI_TEST_CONFIG,
} from "./cli-setup.js";

beforeAll(async () => {
  await setupCLITests();
}, CLI_TEST_CONFIG.connectTimeout + 10000);

/**
 * `load messages` pages back through history via fetchMessageHistory. A chat
 * with nothing older than what is already synced never gets a response, so the
 * client's own 30s guard fires and the command reports failure.
 *
 * These tests used to assert `true` unconditionally, which meant they could not
 * tell "this chat has no older history" (expected, and the normal state for a
 * send-to-self test chat) from "history loading is broken" (a real defect).
 * They now accept either outcome but require the no-history case to say so,
 * which is the distinction that was missing.
 */
const NO_HISTORY = /no (older )?(messages|history)|timeout waiting for history/i;

describe("CLI Load Commands", () => {
  test("load messages either loads history or reports there is none", async () => {
    if (!isConnected()) {
      console.log("⏭️  Skipping: not connected");
      return;
    }
    if (!CLI_TEST_CONFIG.contactPhoneA) {
      console.log("⏭️  Skipping: no contact configured");
      return;
    }
    const jid = `${CLI_TEST_CONFIG.contactPhoneA}@s.whatsapp.net`;
    const capture = captureConsole();
    try {
      const result = await runCmd("load", ["messages", jid]);
      if (result !== true) {
        expect(capture.getFullOutput()).toMatch(NO_HISTORY);
      }
    } finally {
      capture.stop();
    }
  });

  test("load messages with --count either loads or reports no history", async () => {
    if (!isConnected()) {
      console.log("⏭️  Skipping: not connected");
      return;
    }
    if (!CLI_TEST_CONFIG.contactPhoneA) {
      console.log("⏭️  Skipping: no contact configured");
      return;
    }
    const jid = `${CLI_TEST_CONFIG.contactPhoneA}@s.whatsapp.net`;
    const capture = captureConsole();
    try {
      const result = await runCmd("load", ["messages", jid, "--count", "10"]);
      if (result !== true) {
        expect(capture.getFullOutput()).toMatch(NO_HISTORY);
      }
    } finally {
      capture.stop();
    }
  });

  test("load messages with --json outputs valid JSON", async () => {
    if (!isConnected()) {
      console.log("⏭️  Skipping: not connected");
      return;
    }
    if (!CLI_TEST_CONFIG.contactPhoneA) {
      console.log("⏭️  Skipping: no contact configured");
      return;
    }
    const jid = `${CLI_TEST_CONFIG.contactPhoneA}@s.whatsapp.net`;
    const capture = captureConsole();
    try {
      const result = await runCmd("load", ["messages", jid, "--count", "5"], { jsonOutput: true });
      const output = capture.getFullOutput();
      // Whatever the outcome, --json must emit parseable JSON and nothing else.
      // That is the part worth asserting here; whether this chat happens to
      // have older history is not under our control.
      expect(() => JSON.parse(output)).not.toThrow();
      if (result !== true) {
        expect(JSON.parse(output)).toHaveProperty("success", false);
      }
    } finally {
      capture.stop();
    }
  });

  test("load messages missing jid returns false", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("load", ["messages"]);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage:");
    } finally {
      capture.stop();
    }
  });

  test("unknown load subcommand returns false", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("load", ["foobar"]);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Unknown load command: foobar");
    } finally {
      capture.stop();
    }
  });
});
