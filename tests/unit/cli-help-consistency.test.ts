/**
 * Unit Tests: REPL help/completion consistency
 *
 * Regression guard for a defect found by audit, not by any test: the `help`
 * tab-completion list, the "Available topics" line and the dispatch inside
 * `showReplHelp()` were three separately-maintained lists. Five topics
 * (`chat`, `story`, `community`, `call`, `business`) were offered by
 * completion but had no case, so tab-completing them printed
 * "❌ Unknown help topic".
 *
 * The lists are now all derived from `HELP_TOPIC_HANDLERS`, so this suite
 * checks the property that matters end-to-end: every advertised topic renders
 * real help, and the error path names exactly the topics that work.
 *
 * repl.ts transitively imports MiawClient -> baileys (ESM), which jest can't
 * load without transforming, so baileys is mocked purely to satisfy the
 * import chain (same pattern as repl-tokenize.test.ts).
 */

import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

jest.unstable_mockModule("@whiskeysockets/baileys", () => ({
  default: jest.fn(),
  makeWASocket: jest.fn(),
  DisconnectReason: { loggedOut: 401, connectionClosed: 428, connectionReplaced: 440 },
  fetchLatestBaileysVersion: jest
    .fn<() => Promise<unknown>>()
    .mockResolvedValue({ version: [2, 3000, 1] }),
  fetchLatestWaWebVersion: jest
    .fn<() => Promise<unknown>>()
    .mockResolvedValue({ version: [2, 3000, 1], isLatest: true }),
  DEFAULT_CONNECTION_CONFIG: { version: [2, 3000, 1] },
  makeCacheableSignalKeyStore: jest.fn(),
  Browsers: { macOS: jest.fn(() => ["macOS", "Chrome", "1.0"]) },
  useMultiFileAuthState: jest.fn(),
  downloadMediaMessage: jest.fn(),
  jidNormalizedUser: jest.fn((jid: string) => jid),
  getAggregateVotesInPollMessage: jest.fn(),
}));

const { HELP_TOPICS, showReplHelp } = await import("../../src/cli/repl.js");

/** Capture console.log output for one call. */
function capture(run: () => void): string {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    run();
  } finally {
    console.log = original;
  }
  return lines.join("\n");
}

describe("REPL help topics", () => {
  it("advertises at least the known topic set", () => {
    expect(HELP_TOPICS.length).toBeGreaterThanOrEqual(19);
  });

  // The five that regressed. Named explicitly so a future refactor that drops
  // one fails here with an obvious message rather than silently shrinking the
  // derived list (which every other assertion in this file would follow).
  it.each(["chat", "story", "community", "call", "business"])(
    "still offers the previously-broken topic %s",
    (topic) => {
      expect(HELP_TOPICS).toContain(topic);
    }
  );

  it("renders real help for every advertised topic", () => {
    const broken: string[] = [];
    for (const topic of HELP_TOPICS) {
      const output = capture(() => showReplHelp(topic));
      if (output.includes("Unknown help topic") || output.trim().length === 0) {
        broken.push(topic);
      }
    }
    expect(broken).toEqual([]);
  });

  it("renders help for a topic regardless of case", () => {
    const output = capture(() => showReplHelp("COMMUNITY"));
    expect(output).not.toContain("Unknown help topic");
    expect(output).toContain("Community Commands");
  });

  it("rejects an unknown topic and lists exactly the working topics", () => {
    const output = capture(() => showReplHelp("definitely-not-a-topic"));
    expect(output).toContain("Unknown help topic");

    const listed = output
      .split("\n")
      .find((line) => line.startsWith("Available topics:"))
      ?.replace("Available topics:", "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    // The advertised set and the dispatchable set must be the same set —
    // this is the exact invariant that was broken.
    expect(listed).toEqual(HELP_TOPICS);
  });

  it("shows the full banner for an empty topic", () => {
    const output = capture(() => showReplHelp(""));
    expect(output).toContain("REPL Commands");
    expect(output).not.toContain("Unknown help topic");
  });

  it("names every topic in the full banner's topic line", () => {
    const output = capture(() => showReplHelp(""));
    for (const topic of HELP_TOPICS) {
      expect(output).toContain(topic);
    }
  });
});
