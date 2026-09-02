/**
 * CLI Integration Tests: Command Router
 *
 * Tests routing logic: unknown commands, missing subcommands, missing args.
 * Most of these do NOT require a live connection — they fail at the routing level.
 */

import {
  setupCLITests,
  runCmd,
  captureConsole,
  isConnected,
  CLI_TEST_CONFIG,
} from "./cli-setup.js";
import {
  GROUP_COMMANDS,
  COMMUNITY_COMMANDS,
} from "../../../src/cli/commands/index.js";

/** Pull the advertised subcommand words out of a "Commands: a, b, c" string. */
function advertised(list: string): string[] {
  return list
    .replace(/^Commands:\s*/, "")
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);
}

beforeAll(async () => {
  await setupCLITests();
}, CLI_TEST_CONFIG.connectTimeout + 10000);

describe("CLI Command Router", () => {
  test("unknown command returns false", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("nonexistent_command", []);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Unknown command");
    } finally {
      capture.stop();
    }
  });

  test("get without subcommand shows usage", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("get", []);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage: get <command>");
    } finally {
      capture.stop();
    }
  });

  test("unknown get subcommand returns false", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("get", ["foobar"]);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Unknown get command: foobar");
    } finally {
      capture.stop();
    }
  });

  test("send without subcommand shows usage", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("send", []);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage:");
    } finally {
      capture.stop();
    }
  });

  test("send text missing args returns false", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("send", ["text"]);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage:");
    } finally {
      capture.stop();
    }
  });

  test("group without subcommand shows usage", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("group", []);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage: group <command>");
    } finally {
      capture.stop();
    }
  });

  test("contact without subcommand shows usage", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("contact", []);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage: contact <command>");
    } finally {
      capture.stop();
    }
  });

  test("profile without subcommand shows usage", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("profile", []);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage:");
    } finally {
      capture.stop();
    }
  });

  test("label without subcommand shows usage", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("label", []);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage: label <command>");
    } finally {
      capture.stop();
    }
  });

  test("catalog without subcommand shows usage", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("catalog", []);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage: catalog <command>");
    } finally {
      capture.stop();
    }
  });

  test("instance without subcommand shows usage", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("instance", []);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage: instance <command>");
    } finally {
      capture.stop();
    }
  });

  test("get messages missing jid returns false", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("get", ["messages"]);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage:");
    } finally {
      capture.stop();
    }
  });

  test("check with no args returns false", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("check", []);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage:");
    } finally {
      capture.stop();
    }
  });

  test("load without subcommand shows usage", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("load", []);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage: load <command>");
    } finally {
      capture.stop();
    }
  });

  test("media without subcommand shows usage", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("media", []);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage: media <command>");
    } finally {
      capture.stop();
    }
  });

  // --- Missing args error cases ---

  test("send image missing args returns false", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("send", ["image"]);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage:");
    } finally {
      capture.stop();
    }
  });

  test("send document missing args returns false", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("send", ["document"]);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage:");
    } finally {
      capture.stop();
    }
  });

  test("send video missing args returns false", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("send", ["video"]);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage:");
    } finally {
      capture.stop();
    }
  });

  test("send audio missing args returns false", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("send", ["audio"]);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage:");
    } finally {
      capture.stop();
    }
  });

  test("media download missing args returns false", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("media", ["download"]);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage:");
    } finally {
      capture.stop();
    }
  });

  test("contact info missing phone returns false", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("contact", ["info"]);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage:");
    } finally {
      capture.stop();
    }
  });

  test("contact business missing phone returns false", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("contact", ["business"]);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage:");
    } finally {
      capture.stop();
    }
  });

  test("contact picture missing phone returns false", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("contact", ["picture"]);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage:");
    } finally {
      capture.stop();
    }
  });

  test("group participants missing jid returns false", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("group", ["participants"]);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage:");
    } finally {
      capture.stop();
    }
  });

  test("group invite-link missing jid returns false", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("group", ["invite-link"]);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage:");
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

  // ============================================
  // Group & Community Admin (v1.12.0)
  // ============================================
  //
  // These all fail at the routing level -- a bad toggle or a missing JID is
  // rejected before the client is touched -- so they run without a connection.

  describe.each([
    ["group", "announce"],
    ["group", "restrict"],
    ["group", "approval"],
    ["community", "announce"],
    ["community", "restrict"],
    ["community", "approval"],
  ])("%s %s", (command, sub) => {
    test("missing jid shows usage", async () => {
      const capture = captureConsole();
      try {
        const result = await runCmd(command, [sub]);
        expect(result).toBe(false);
        expect(capture.getFullOutput()).toContain("Usage:");
      } finally {
        capture.stop();
      }
    });

    test("unparseable toggle shows usage rather than guessing", async () => {
      const capture = captureConsole();
      try {
        const result = await runCmd(command, [sub, "123@g.us", "maybe"]);
        expect(result).toBe(false);
        expect(capture.getFullOutput()).toContain("Usage:");
      } finally {
        capture.stop();
      }
    });
  });

  describe.each(["group", "community"])("%s add-mode", (command) => {
    test("unrecognized mode shows usage", async () => {
      const capture = captureConsole();
      try {
        const result = await runCmd(command, ["add-mode", "123@g.us", "nobody"]);
        expect(result).toBe(false);
        expect(capture.getFullOutput()).toContain("Usage:");
      } finally {
        capture.stop();
      }
    });
  });

  describe.each(["group", "community"])("%s ephemeral", (command) => {
    test("unparseable duration shows usage", async () => {
      const capture = captureConsole();
      try {
        const result = await runCmd(command, ["ephemeral", "123@g.us", "soon"]);
        expect(result).toBe(false);
        expect(capture.getFullOutput()).toContain("Usage:");
      } finally {
        capture.stop();
      }
    });

    test("a negative duration is rejected", async () => {
      const capture = captureConsole();
      try {
        const result = await runCmd(command, ["ephemeral", "123@g.us", "-1"]);
        expect(result).toBe(false);
        expect(capture.getFullOutput()).toContain("Usage:");
      } finally {
        capture.stop();
      }
    });

    test("an omitted duration shows usage instead of disabling", async () => {
      // Regression: Number("") is 0, and 0 is a valid duration meaning "off",
      // so a missing argument used to parse as a successful request to turn
      // disappearing messages OFF for the whole group.
      const capture = captureConsole();
      try {
        const result = await runCmd(command, ["ephemeral", "123@g.us"]);
        expect(result).toBe(false);
        expect(capture.getFullOutput()).toContain("Usage:");
      } finally {
        capture.stop();
      }
    });
  });

  describe.each(["group", "community"])("%s requests", (command) => {
    test("unknown subcommand shows usage", async () => {
      const capture = captureConsole();
      try {
        const result = await runCmd(command, ["requests", "foobar"]);
        expect(result).toBe(false);
        expect(capture.getFullOutput()).toContain("Usage:");
      } finally {
        capture.stop();
      }
    });

    test("list without a jid shows usage", async () => {
      const capture = captureConsole();
      try {
        const result = await runCmd(command, ["requests", "list"]);
        expect(result).toBe(false);
        expect(capture.getFullOutput()).toContain("Usage:");
      } finally {
        capture.stop();
      }
    });

    test("approve without phones shows usage", async () => {
      const capture = captureConsole();
      try {
        const result = await runCmd(command, ["requests", "approve", "123@g.us"]);
        expect(result).toBe(false);
        expect(capture.getFullOutput()).toContain("Usage:");
      } finally {
        capture.stop();
      }
    });
  });

  test("group usage line advertises the new admin subcommands", async () => {
    const capture = captureConsole();
    try {
      await runCmd("group", []);
      const output = capture.getFullOutput();
      for (const sub of ["announce", "restrict", "add-mode", "approval", "ephemeral", "requests"]) {
        expect(output).toContain(sub);
      }
    } finally {
      capture.stop();
    }
  });

  // ============================================
  // Privacy & Blocklist (v1.12.0)
  // ============================================
  //
  // cmdPrivacySet validates the setting name and its value BEFORE asking for a
  // connection, precisely so a typo cannot silently change the wrong setting.
  // That makes these routable offline.

  test("privacy set with an unknown setting lists the valid ones", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("privacy", ["set", "nonsense", "all"]);
      expect(result).toBe(false);
      const output = capture.getFullOutput();
      expect(output).toContain("Unknown privacy setting");
      expect(output).toContain("last-seen");
    } finally {
      capture.stop();
    }
  });

  test("privacy set with an out-of-range value lists the accepted ones", async () => {
    const capture = captureConsole();
    try {
      // "known" is valid for calls but not for last-seen -- the kind of mix-up
      // that would otherwise reach WhatsApp and fail opaquely.
      const result = await runCmd("privacy", ["set", "last-seen", "known"]);
      expect(result).toBe(false);
      const output = capture.getFullOutput();
      expect(output).toContain("Invalid value");
      expect(output).toContain("contact_blacklist");
    } finally {
      capture.stop();
    }
  });

  test("privacy set with missing args shows usage", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("privacy", ["set", "last-seen"]);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage:");
    } finally {
      capture.stop();
    }
  });

  test("unknown privacy subcommand shows the command list", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("privacy", ["foobar"]);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Unknown privacy command");
    } finally {
      capture.stop();
    }
  });

  test("privacy disappearing with an unparseable duration shows usage", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("privacy", ["disappearing", "soon"]);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage:");
    } finally {
      capture.stop();
    }
  });

  test("privacy disappearing with no duration shows usage instead of disabling", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("privacy", ["disappearing"]);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage:");
    } finally {
      capture.stop();
    }
  });

  test("privacy link-previews with a bad toggle shows usage", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("privacy", ["link-previews", "maybe"]);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage:");
    } finally {
      capture.stop();
    }
  });

  test.each(["add", "remove"])(
    "block %s without a phone shows usage",
    async (sub) => {
      const capture = captureConsole();
      try {
        const result = await runCmd("block", [sub]);
        expect(result).toBe(false);
        expect(capture.getFullOutput()).toContain("Usage:");
      } finally {
        capture.stop();
      }
    }
  );

  test("unknown block subcommand shows the command list", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("block", ["foobar"]);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Unknown block command");
    } finally {
      capture.stop();
    }
  });

  // ============================================
  // Group invites & pinning (v1.12.0)
  // ============================================

  test("send group-invite with missing args shows usage", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("send", ["group-invite", "6281234567890"]);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage:");
    } finally {
      capture.stop();
    }
  });

  test("chat ephemeral with no duration shows usage instead of disabling", async () => {
    const capture = captureConsole();
    try {
      const result = await runCmd("chat", ["ephemeral", "6281234567890"]);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage:");
    } finally {
      capture.stop();
    }
  });

  test.each(["pin-message", "unpin-message"])(
    "chat %s without a message id shows usage",
    async (sub) => {
      const capture = captureConsole();
      try {
        const result = await runCmd("chat", [sub, "6281234567890"]);
        expect(result).toBe(false);
        expect(capture.getFullOutput()).toContain("Usage:");
      } finally {
        capture.stop();
      }
    }
  );

  test("chat pin-message rejects a duration WhatsApp does not accept", async () => {
    const capture = captureConsole();
    try {
      // WhatsApp allows only 24h / 7d / 30d here -- 90d is valid for
      // disappearing messages, which is exactly the confusion to catch.
      const result = await runCmd("chat", [
        "pin-message",
        "6281234567890",
        "MSG1",
        "90d",
      ]);
      expect(result).toBe(false);
      expect(capture.getFullOutput()).toContain("Usage:");
    } finally {
      capture.stop();
    }
  });

  test("chat usage line advertises the pin-message subcommands", async () => {
    const capture = captureConsole();
    try {
      await runCmd("chat", []);
      const output = capture.getFullOutput();
      expect(output).toContain("pin-message");
      expect(output).toContain("ephemeral");
    } finally {
      capture.stop();
    }
  });

  test("community usage line advertises the new admin subcommands", async () => {
    const capture = captureConsole();
    try {
      await runCmd("community", []);
      const output = capture.getFullOutput();
      for (const sub of ["announce", "restrict", "add-mode", "approval", "ephemeral", "requests"]) {
        expect(output).toContain(sub);
      }
    } finally {
      capture.stop();
    }
  });
});

/**
 * Every subcommand the `group` / `community` usage lines advertise must reach a
 * handler. `community invite-link` was advertised from v1.9.0 but had no case,
 * so it fell through to the unknown-command branch and always errored — no test
 * covered it because the existing tests only assert that the usage *text*
 * contains the word, not that the word works.
 */
describe("advertised subcommands reach a handler", () => {
  /**
   * These subcommands need no arguments, so dispatching them actually performs
   * the fetch instead of stopping at an argument guard. Without a connection
   * they block until the 60s test timeout, so they are gated — their real
   * coverage lives in 05-group-commands.test.ts.
   */
  const FETCHES_IMMEDIATELY = new Set(["list", "ls"]);

  test.each(advertised(GROUP_COMMANDS))("group %s is dispatchable", async (sub) => {
    if (FETCHES_IMMEDIATELY.has(sub) && !isConnected()) return;
    const capture = captureConsole();
    try {
      await runCmd("group", [sub]);
      expect(capture.getFullOutput()).not.toContain(`Unknown group command: ${sub}`);
    } finally {
      capture.stop();
    }
  });

  test.each(advertised(COMMUNITY_COMMANDS))("community %s is dispatchable", async (sub) => {
    if (FETCHES_IMMEDIATELY.has(sub) && !isConnected()) return;
    const capture = captureConsole();
    try {
      await runCmd("community", [sub]);
      expect(capture.getFullOutput()).not.toContain(`Unknown community command: ${sub}`);
    } finally {
      capture.stop();
    }
  });
});
