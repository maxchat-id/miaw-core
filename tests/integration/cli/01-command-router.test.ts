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
  CLI_TEST_CONFIG,
} from "./cli-setup.js";

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
