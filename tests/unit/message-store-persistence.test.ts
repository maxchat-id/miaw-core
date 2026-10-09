import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { jest, describe, beforeEach, afterEach, it, expect } from "@jest/globals";

jest.unstable_mockModule("@whiskeysockets/baileys", () => ({
  default: jest.fn(),
  makeWASocket: jest.fn(),
  DisconnectReason: { loggedOut: 401 },
  fetchLatestBaileysVersion: jest
    .fn<() => Promise<unknown>>()
    .mockResolvedValue({ version: [2, 2413, 1] }),
  fetchLatestWaWebVersion: jest
    .fn<() => Promise<unknown>>()
    .mockResolvedValue({ version: [2, 2413, 1], isLatest: true }),
  DEFAULT_CONNECTION_CONFIG: { version: [2, 2413, 1] },
  makeCacheableSignalKeyStore: jest.fn(),
  Browsers: { macOS: jest.fn(() => ["macOS", "Chrome", "1.0"]) },
  useMultiFileAuthState: jest.fn(),
  downloadMediaMessage: jest.fn(),
  jidNormalizedUser: jest.fn((jid: string) => jid),
  getAggregateVotesInPollMessage: jest.fn(),
}));

const { MiawClient } = await import("../../src/client/MiawClient.js");

const CHAT_COUNT = 500;
const HISTORY_MESSAGE_COUNT = 10_000;

type RawMessage = {
  key: { id: string; remoteJid: string; fromMe: false };
  message: { conversation: string } | null;
  messageStubType?: number;
  pushName: string;
  messageTimestamp: number;
};

function textMessage(id: string, chatIndex: number): RawMessage {
  return {
    key: {
      id,
      remoteJid: `628000${chatIndex.toString().padStart(7, "0")}@s.whatsapp.net`,
      fromMe: false,
    },
    message: { conversation: "benchmark payload" },
    pushName: "Sender",
    messageTimestamp: 1000,
  };
}

function placeholderMessage(id: string, chatIndex: number): RawMessage {
  return {
    ...textMessage(id, chatIndex),
    message: null,
    messageStubType: 75,
  };
}

function makeClient(): {
  client: any;
  checkpoint: jest.Mock;
  emitUpsert: (...messages: RawMessage[]) => Promise<void>;
  emitHistory: (messages: RawMessage[]) => void;
} {
  const client: any = new MiawClient({ instanceId: "test-message-persistence" });
  const checkpoint = jest
    .spyOn(client, "flushMessagesToFile")
    .mockResolvedValue(undefined) as unknown as jest.Mock;
  jest.spyOn(client, "saveLidMappingsToFile").mockImplementation(() => {});
  jest.spyOn(client, "saveChatsToFile").mockImplementation(() => {});
  jest.spyOn(client, "saveContactsToFile").mockImplementation(() => {});
  client.messagesStore.clear();

  const handlers: Record<string, (arg: any) => any> = {};
  client.socket = {
    ev: {
      on: (event: string, handler: (arg: any) => any) => {
        handlers[event] = handler;
      },
    },
  };
  client.registerSocketEvents(async () => {});

  return {
    client,
    checkpoint,
    emitUpsert: (...messages) =>
      handlers["messages.upsert"]({ type: "notify", messages }),
    emitHistory: (messages) =>
      handlers["messaging-history.set"]({
        contacts: [],
        chats: [],
        messages,
        isLatest: true,
      }),
  };
}

describe("message-store persistence scheduling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("coalesces live upserts within one second into one checkpoint request", async () => {
    jest.useFakeTimers();
    const ctx = makeClient();

    await ctx.emitUpsert(
      textMessage("LIVE-1", 0),
      textMessage("LIVE-2", 1),
      textMessage("LIVE-3", 2)
    );
    await jest.advanceTimersByTimeAsync(999);
    expect(ctx.checkpoint).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);

    expect(ctx.client.getMessageCounts().size).toBe(3);
    expect(ctx.checkpoint).toHaveBeenCalledTimes(1);
  });

  it("uses a new fixed deadline for a later live window", async () => {
    jest.useFakeTimers();
    const ctx = makeClient();

    await ctx.emitUpsert(textMessage("LIVE-1", 0));
    await jest.advanceTimersByTimeAsync(1000);
    expect(ctx.checkpoint).toHaveBeenCalledTimes(1);

    await ctx.emitUpsert(textMessage("LIVE-2", 0));
    await jest.advanceTimersByTimeAsync(999);
    expect(ctx.checkpoint).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(ctx.checkpoint).toHaveBeenCalledTimes(2);
  });

  it("does not push the first deadline back under continuous traffic", async () => {
    jest.useFakeTimers();
    const ctx = makeClient();

    await ctx.emitUpsert(textMessage("LIVE-0", 0));
    for (let index = 1; index <= 4; index++) {
      await jest.advanceTimersByTimeAsync(200);
      await ctx.emitUpsert(textMessage(`LIVE-${index}`, index));
    }
    expect(ctx.checkpoint).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(200);
    expect(ctx.checkpoint).toHaveBeenCalledTimes(1);
  });

  it("does not schedule duplicates but schedules placeholder upgrades", async () => {
    jest.useFakeTimers();
    const ctx = makeClient();

    await ctx.emitUpsert(textMessage("DUPLICATE", 0));
    await jest.advanceTimersByTimeAsync(1000);
    expect(ctx.checkpoint).toHaveBeenCalledTimes(1);

    await ctx.emitUpsert(textMessage("DUPLICATE", 0));
    await jest.advanceTimersByTimeAsync(1000);
    expect(ctx.checkpoint).toHaveBeenCalledTimes(1);

    await ctx.emitUpsert(placeholderMessage("UPGRADE", 0));
    await ctx.emitUpsert(textMessage("UPGRADE", 0));
    await jest.advanceTimersByTimeAsync(1000);
    expect(ctx.checkpoint).toHaveBeenCalledTimes(2);
  });

  it("gives mutations during an active checkpoint the next fixed deadline", async () => {
    jest.useFakeTimers();
    const ctx = makeClient();
    let releaseCheckpoint!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseCheckpoint = resolve;
    });
    ctx.checkpoint.mockImplementationOnce(() => blocked);

    await ctx.emitUpsert(textMessage("LIVE-1", 0));
    await jest.advanceTimersByTimeAsync(1000);
    expect(ctx.checkpoint).toHaveBeenCalledTimes(1);

    await ctx.emitUpsert(textMessage("LIVE-2", 0));
    await jest.advanceTimersByTimeAsync(999);
    expect(ctx.checkpoint).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(ctx.checkpoint).toHaveBeenCalledTimes(2);
    releaseCheckpoint();
  });

  it("starts a later debounce cycle after timer failure", async () => {
    jest.useFakeTimers();
    const ctx = makeClient();
    ctx.checkpoint.mockImplementationOnce(async () => {
      throw new Error("injected timer failure");
    });

    await ctx.emitUpsert(textMessage("LIVE-1", 0));
    await jest.advanceTimersByTimeAsync(1000);
    expect(ctx.checkpoint).toHaveBeenCalledTimes(1);

    await ctx.emitUpsert(textMessage("LIVE-2", 0));
    await jest.advanceTimersByTimeAsync(1000);
    expect(ctx.checkpoint).toHaveBeenCalledTimes(2);
  });

  it("requests at most one checkpoint for a 10,000-message history event", async () => {
    jest.useFakeTimers();
    const ctx = makeClient();
    const messages = Array.from({ length: HISTORY_MESSAGE_COUNT }, (_, index) =>
      textMessage(`HISTORY-${index}`, index % CHAT_COUNT)
    );

    ctx.emitHistory(messages);
    expect(ctx.checkpoint).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1000);

    const finalCount = Array.from(
      ctx.client.messagesStore.values() as Iterable<unknown[]>
    ).reduce((total, bucket) => total + bucket.length, 0);
    expect(finalCount).toBe(HISTORY_MESSAGE_COUNT);
    expect(ctx.checkpoint).toHaveBeenCalledTimes(1);
  });

  it("schedules one checkpoint for a same-batch history upgrade", async () => {
    jest.useFakeTimers();
    const ctx = makeClient();

    ctx.emitHistory([
      placeholderMessage("HISTORY-UPGRADE", 0),
      textMessage("HISTORY-UPGRADE", 0),
    ]);
    await jest.advanceTimersByTimeAsync(1000);

    const bucket = Array.from(
      ctx.client.messagesStore.values() as Iterable<Array<{ text?: string }>>
    )[0];
    expect(bucket).toHaveLength(1);
    expect(bucket[0].text).toBe("benchmark payload");
    expect(ctx.checkpoint).toHaveBeenCalledTimes(1);
  });

  it("does not schedule an unchanged history event", async () => {
    jest.useFakeTimers();
    const ctx = makeClient();
    const messages = [textMessage("HISTORY-1", 0)];

    ctx.emitHistory(messages);
    await jest.advanceTimersByTimeAsync(1000);
    expect(ctx.checkpoint).toHaveBeenCalledTimes(1);

    ctx.emitHistory(messages);
    ctx.emitHistory([]);
    await jest.advanceTimersByTimeAsync(1000);
    expect(ctx.checkpoint).toHaveBeenCalledTimes(1);
  });
});

describe("message-store atomic checkpoints", () => {
  let sessionPath: string;
  const instanceId = "atomic-checkpoint";

  beforeEach(() => {
    jest.clearAllMocks();
    sessionPath = mkdtempSync(join(tmpdir(), "miaw-message-persistence-"));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    rmSync(sessionPath, { recursive: true, force: true });
  });

  function persistenceClient(): any {
    const client: any = new MiawClient({ instanceId, sessionPath });
    client.messagesStore.clear();
    client.messageIdIndex.clear();
    return client;
  }

  function store(client: any, id: string, persist = false): void {
    client.storeMessage({
      id,
      from: "6281234567890@s.whatsapp.net",
      fromMe: false,
      type: "text",
      text: `payload-${id}`,
      timestamp: 1000,
      isGroup: false,
    }, persist);
  }

  function messagesPath(): string {
    return join(sessionPath, instanceId, "messages.json");
  }

  function ownedTemps(): string[] {
    const directory = join(sessionPath, instanceId);
    return existsSync(directory)
      ? readdirSync(directory).filter((name) =>
          name.startsWith("messages.json.tmp-")
        )
      : [];
  }

  it("writes compact JSON atomically and reloads the same schema", async () => {
    const client = persistenceClient();
    store(client, "A");

    await client.flushMessagesToFile();

    const payload = readFileSync(messagesPath(), "utf8");
    expect(payload).not.toContain("\n");
    expect(Object.values(JSON.parse(payload))[0]).toHaveLength(1);
    expect(ownedTemps()).toEqual([]);
    expect(client.currentMessageRevision).toBe(1);
    expect(client.persistedMessageRevision).toBe(1);

    const reloaded = persistenceClient();
    reloaded.loadMessagesFromFile();
    await expect(
      reloaded.getChatMessages("6281234567890@s.whatsapp.net")
    ).resolves.toMatchObject({
      success: true,
      messages: [{ id: "A", text: "payload-A" }],
    });
  });

  it("shares one physical write across concurrent flush callers", async () => {
    const client = persistenceClient();
    store(client, "A");
    const write = jest.spyOn(client, "writeMessagesSnapshot");

    await Promise.all([
      client.flushMessagesToFile(),
      client.flushMessagesToFile(),
      client.flushMessagesToFile(),
    ]);

    expect(write).toHaveBeenCalledTimes(1);
    expect(client.persistedMessageRevision).toBe(1);
  });

  it("serializes fixed-deadline checkpoints across active I/O", async () => {
    jest.useFakeTimers();
    const client = persistenceClient();
    let releaseFirstWrite!: () => void;
    let markFirstStarted!: () => void;
    let markSecondStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const secondStarted = new Promise<void>((resolve) => {
      markSecondStarted = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const originalWrite = client.writeMessagesSnapshot.bind(client);
    const write = jest
      .spyOn(client, "writeMessagesSnapshot")
      .mockImplementation(async (...args: unknown[]) => {
        const [tempPath, payload] = args as [string, string];
        if (write.mock.calls.length === 1) {
          markFirstStarted();
          await firstRelease;
        } else {
          markSecondStarted();
        }
        await originalWrite(tempPath, payload);
      });

    store(client, "A", true);
    await jest.advanceTimersByTimeAsync(1000);
    await firstStarted;

    store(client, "B", true);
    await jest.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);

    releaseFirstWrite();
    await secondStarted;
    await client.messageCheckpointPromise;

    const stored = Object.values(JSON.parse(readFileSync(messagesPath(), "utf8")))[0] as Array<{ id: string }>;
    expect(stored.map((message) => message.id)).toEqual(["A", "B"]);
    expect(write).toHaveBeenCalledTimes(2);
    expect(client.persistedMessageRevision).toBe(2);
  });

  it("keeps each concurrent flush behind its captured revision", async () => {
    const client = persistenceClient();
    store(client, "A");
    let releaseFirstWrite!: () => void;
    let releaseSecondWrite!: () => void;
    let markFirstStarted!: () => void;
    let markSecondStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const secondStarted = new Promise<void>((resolve) => {
      markSecondStarted = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const secondRelease = new Promise<void>((resolve) => {
      releaseSecondWrite = resolve;
    });
    const originalWrite = client.writeMessagesSnapshot.bind(client);
    const write = jest
      .spyOn(client, "writeMessagesSnapshot")
      .mockImplementation(async (...args: unknown[]) => {
        const [tempPath, payload] = args as [string, string];
        if (write.mock.calls.length === 1) {
          markFirstStarted();
          await firstRelease;
        } else {
          markSecondStarted();
          await secondRelease;
        }
        await originalWrite(tempPath, payload);
      });

    let firstResolved = false;
    let secondResolved = false;
    const firstFlush = client.flushMessagesToFile().then(() => {
      firstResolved = true;
    });
    await firstStarted;
    store(client, "B");
    const secondFlush = client.flushMessagesToFile().then(() => {
      secondResolved = true;
    });

    releaseFirstWrite();
    await firstFlush;
    expect(firstResolved).toBe(true);
    expect(secondResolved).toBe(false);

    await secondStarted;
    releaseSecondWrite();
    await secondFlush;

    const stored = Object.values(JSON.parse(readFileSync(messagesPath(), "utf8")))[0] as Array<{ id: string }>;
    expect(stored.map((message) => message.id)).toEqual(["A", "B"]);
    expect(write).toHaveBeenCalledTimes(2);
    expect(client.persistedMessageRevision).toBe(2);
  });

  it("does not lose a mutation made while the writer settles", async () => {
    jest.useFakeTimers();
    const client = persistenceClient();
    store(client, "A");
    const originalCommit = client.commitMessagesSnapshot.bind(client);
    const originalWrite = client.writeMessagesSnapshot.bind(client);
    let mutated = false;
    let markSecondWritten!: () => void;
    const secondWritten = new Promise<void>((resolve) => {
      markSecondWritten = resolve;
    });
    const write = jest
      .spyOn(client, "writeMessagesSnapshot")
      .mockImplementation(async (...args: unknown[]) => {
        await originalWrite(...(args as [string, string]));
        if (write.mock.calls.length === 2) markSecondWritten();
      });
    jest
      .spyOn(client, "commitMessagesSnapshot")
      .mockImplementation((...args: unknown[]) => {
        originalCommit(...(args as [string, string]));
        if (!mutated) {
          mutated = true;
          store(client, "B", true);
        }
      });

    await client.flushMessagesToFile();
    await jest.advanceTimersByTimeAsync(1000);
    await secondWritten;
    await client.messageCheckpointPromise;

    const stored = Object.values(JSON.parse(readFileSync(messagesPath(), "utf8")))[0] as Array<{ id: string }>;
    expect(stored.map((message) => message.id)).toEqual(["A", "B"]);
    expect(write).toHaveBeenCalledTimes(2);
    expect(client.persistedMessageRevision).toBe(2);
  });

  it.each(["write", "commit"] as const)(
    "keeps the previous target valid when %s fails",
    async (failurePoint) => {
      mkdirSync(join(sessionPath, instanceId), { recursive: true });
      writeFileSync(messagesPath(), JSON.stringify({ previous: [{ id: "OLD" }] }));
      const client = persistenceClient();
      store(client, "NEW");

      const wait = jest
        .spyOn(client, "waitForMessageCheckpointRetry")
        .mockResolvedValue(undefined);
      const failure = failurePoint === "write"
        ? jest
            .spyOn(client, "writeMessagesSnapshot")
            .mockRejectedValue(new Error("injected write failure"))
        : jest
            .spyOn(client, "commitMessagesSnapshot")
            .mockImplementation(() => {
              throw new Error("injected commit failure");
            });

      await expect(client.flushMessagesToFile()).rejects.toThrow(
        `injected ${failurePoint} failure`
      );

      expect(failure).toHaveBeenCalledTimes(3);
      expect(wait.mock.calls).toEqual([[250], [1000]]);

      expect(JSON.parse(readFileSync(messagesPath(), "utf8"))).toEqual({
        previous: [{ id: "OLD" }],
      });
      expect(ownedTemps()).toEqual([]);
      expect(client.persistedMessageRevision).toBe(0);
      expect(client.currentMessageRevision).toBe(1);
    }
  );

  it("retries after 250 ms and 1,000 ms, then remains dirty", async () => {
    const client = persistenceClient();
    store(client, "A");
    const attemptedPaths: string[] = [];
    const wait = jest
      .spyOn(client, "waitForMessageCheckpointRetry")
      .mockResolvedValue(undefined);
    jest
      .spyOn(client, "writeMessagesSnapshot")
      .mockImplementation(async (...args: unknown[]) => {
        attemptedPaths.push(args[0] as string);
        throw new Error("injected retry failure");
      });

    await expect(client.flushMessagesToFile()).rejects.toThrow(
      "injected retry failure"
    );

    expect(wait.mock.calls).toEqual([[250], [1000]]);
    expect(attemptedPaths).toHaveLength(3);
    expect(new Set(attemptedPaths)).toHaveProperty("size", 3);
    expect(attemptedPaths.every((tempPath) =>
      basename(tempPath).startsWith(`messages.json.tmp-${process.pid}-`)
    )).toBe(true);
    expect(client.persistedMessageRevision).toBe(0);
    expect(client.currentMessageRevision).toBe(1);
  });

  it("gives a later timer deadline a fresh budget after timer exhaustion", async () => {
    const client = persistenceClient();
    const originalWrite = client.writeMessagesSnapshot.bind(client);
    jest
      .spyOn(client, "waitForMessageCheckpointRetry")
      .mockResolvedValue(undefined);
    let releaseFirstAttempt!: () => void;
    let markFirstAttempt!: () => void;
    const firstAttempt = new Promise<void>((resolve) => {
      markFirstAttempt = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirstAttempt = resolve;
    });
    const write = jest
      .spyOn(client, "writeMessagesSnapshot")
      .mockImplementation(async (...args: unknown[]) => {
        const attempt = write.mock.calls.length;
        if (attempt === 1) {
          markFirstAttempt();
          await firstRelease;
        }
        if (attempt <= 3) throw new Error("timer exhausted");
        await originalWrite(...(args as [string, string]));
      });

    store(client, "A");
    const firstTimer = client.flushMessagesToFile("timer");
    const firstFailure = expect(firstTimer).rejects.toThrow("timer exhausted");
    await firstAttempt;
    store(client, "B");
    const laterTimer = client.flushMessagesToFile("timer");
    releaseFirstAttempt();
    await Promise.all([firstFailure, laterTimer]);

    expect(write).toHaveBeenCalledTimes(4);
    expect(client.persistedMessageRevision).toBe(2);
  });

  it("gives a joining lifecycle flush a fresh budget after timer exhaustion", async () => {
    const client = persistenceClient();
    const originalWrite = client.writeMessagesSnapshot.bind(client);
    const wait = jest
      .spyOn(client, "waitForMessageCheckpointRetry")
      .mockResolvedValue(undefined);
    let releaseFirstAttempt!: () => void;
    let markFirstAttempt!: () => void;
    const firstAttempt = new Promise<void>((resolve) => {
      markFirstAttempt = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirstAttempt = resolve;
    });
    const write = jest
      .spyOn(client, "writeMessagesSnapshot")
      .mockImplementation(async (...args: unknown[]) => {
        const attempt = write.mock.calls.length;
        if (attempt === 1) {
          markFirstAttempt();
          await firstRelease;
        }
        if (attempt <= 3) throw new Error("timer exhausted");
        await originalWrite(...(args as [string, string]));
      });

    store(client, "A");
    const timerCheckpoint = client.flushMessagesToFile("timer");
    const timerFailure = expect(timerCheckpoint).rejects.toThrow(
      "timer exhausted"
    );
    await firstAttempt;
    const lifecycleFlush = client.flushMessagesToFile();
    releaseFirstAttempt();
    await Promise.all([timerFailure, lifecycleFlush]);

    expect(write).toHaveBeenCalledTimes(4);
    expect(wait.mock.calls).toEqual([[250], [1000]]);
    expect(client.persistedMessageRevision).toBe(1);
  });

  it("does not restart an invalidated timer snapshot for a joining lifecycle flush", async () => {
    const client = persistenceClient();
    let releaseWrite!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const originalWrite = client.writeMessagesSnapshot.bind(client);
    const write = jest
      .spyOn(client, "writeMessagesSnapshot")
      .mockImplementationOnce(async (...args: unknown[]) => {
        const [tempPath, payload] = args as [string, string];
        markStarted();
        await release;
        await originalWrite(tempPath, payload);
      });

    store(client, "A");
    const timerCheckpoint = client.flushMessagesToFile("timer");
    const timerFailure = expect(timerCheckpoint).rejects.toThrow(
      "Message persistence was invalidated"
    );
    await started;
    const lifecycleFlush = client.flushMessagesToFile();
    client.persistenceEpoch++;
    releaseWrite();

    await Promise.all([
      timerFailure,
      expect(lifecycleFlush).rejects.toThrow(
        "Message persistence was invalidated"
      ),
    ]);
    expect(write).toHaveBeenCalledTimes(1);
    expect(existsSync(messagesPath())).toBe(false);
    expect(ownedTemps()).toEqual([]);
    expect(client.persistedMessageRevision).toBe(0);
  });

  it("removes only stale owned regular temp files during load", () => {
    const directory = join(sessionPath, instanceId);
    mkdirSync(directory, { recursive: true });
    writeFileSync(messagesPath(), "{}");
    const stale = `${messagesPath()}.tmp-123-stale`;
    const active = `${messagesPath()}.tmp-123-active`;
    const unrelated = join(directory, "messages.json.backup");
    const ownedDirectory = `${messagesPath()}.tmp-123-directory`;
    const symlink = `${messagesPath()}.tmp-123-symlink`;
    writeFileSync(stale, "stale");
    writeFileSync(active, "active");
    writeFileSync(unrelated, "backup");
    mkdirSync(ownedDirectory);
    symlinkSync(unrelated, symlink);
    const client = persistenceClient();
    client.activeMessageTempPaths.add(active);

    client.loadMessagesFromFile();

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(active)).toBe(true);
    expect(existsSync(unrelated)).toBe(true);
    expect(lstatSync(ownedDirectory).isDirectory()).toBe(true);
    expect(lstatSync(symlink).isSymbolicLink()).toBe(true);
  });
});
