import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { Session } from "node:inspector";
import { MiawClient } from "../../src/client/MiawClient.js";

const HISTORY_MESSAGE_COUNT = 10_000;
const CHAT_COUNT = 500;
const LIVE_BURST_COUNT = 2_000;
const WARMUP_RUNS = 1;
const MEASURED_RUNS = 5;

type ScenarioName =
  | "history-500-chats"
  | "live-500-chats"
  | "live-skewed-chat";

type RawMessage = {
  key: { id: string; remoteJid: string; fromMe: false };
  message: { conversation: string };
  pushName: string;
  messageTimestamp: number;
};

type CpuProfile = {
  nodes: Array<{
    id: number;
    callFrame: { functionName: string };
    children?: number[];
  }>;
  samples?: number[];
  timeDeltas?: number[];
};

type TrialResult = {
  scenario: ScenarioName;
  trial: number;
  wallMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  cpuTotalMs: number;
  eventLoopDelayMeanMs: number;
  eventLoopDelayP99Ms: number;
  eventLoopDelayMaxMs: number;
  storeMessageSamplePercent: number;
  writeCount: number;
  writeBytes: number;
  writeBytesMethod: "compact-checkpoint-payload";
  processPeakRssBytes: number;
  finalMessageCount: number;
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function profilerPost<T = Record<string, never>>(
  session: Session,
  method: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    session.post(method, (error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(result as T);
      }
    });
  });
}

function syntheticJid(chatIndex: number): string {
  return `628000${chatIndex.toString().padStart(7, "0")}@s.whatsapp.net`;
}

function rawMessage(id: string, chatIndex: number): RawMessage {
  return {
    key: { id, remoteJid: syntheticJid(chatIndex), fromMe: false },
    message: { conversation: "fixed payload" },
    pushName: "Synthetic Sender",
    messageTimestamp: 1000,
  };
}

function normalizedMessage(id: string, chatIndex: number): Record<string, unknown> {
  const raw = rawMessage(id, chatIndex);
  return {
    id,
    from: raw.key.remoteJid,
    senderPhone: raw.key.remoteJid.slice(0, raw.key.remoteJid.indexOf("@")),
    senderName: raw.pushName,
    text: raw.message.conversation,
    timestamp: raw.messageTimestamp,
    isGroup: false,
    fromMe: false,
    type: "text",
    raw,
  };
}

function createBenchmarkClient(): {
  client: any;
  handlers: Record<string, (argument: any) => any>;
  getWriteCount: () => number;
  getWriteBytes: () => number;
  flushPendingCheckpoint: () => Promise<void>;
} {
  const client: any = new MiawClient({ instanceId: "message-store-benchmark" });
  const handlers: Record<string, (argument: any) => any> = {};
  let writeCount = 0;
  let writeBytes = 0;

  client.persistMessagesSnapshot = async (payload: string) => {
    writeCount++;
    writeBytes += Buffer.byteLength(payload, "utf8");
  };
  client.saveLidMappingsToFile = () => {};
  client.saveChatsToFile = () => {};
  client.saveContactsToFile = () => {};
  client.messagesStore.clear();
  client.socket = {
    ev: {
      on: (event: string, handler: (argument: any) => any) => {
        handlers[event] = handler;
      },
    },
  };
  client.registerSocketEvents(async () => {});

  return {
    client,
    handlers,
    getWriteCount: () => writeCount,
    getWriteBytes: () => writeBytes,
    flushPendingCheckpoint: async () => {
      if (client.messageCheckpointTimer) {
        clearTimeout(client.messageCheckpointTimer);
        client.messageCheckpointTimer = null;
      }
      await client.flushMessagesToFile("timer");
    },
  };
}

function preseed(client: any, skewed: boolean): void {
  const buckets = new Map<string, Array<Record<string, unknown>>>();

  for (let index = 0; index < HISTORY_MESSAGE_COUNT; index++) {
    const chatIndex = skewed ? 0 : index % CHAT_COUNT;
    const jid = syntheticJid(chatIndex);
    const bucket = buckets.get(jid) ?? [];
    bucket.push(normalizedMessage(`SEED-${index}`, chatIndex));
    buckets.set(jid, bucket);
  }

  client.messagesStore = buckets;
  client.messageIdIndex = new Map(
    Array.from(buckets, ([jid, messages]) => [
      jid,
      client.buildMessageIdIndex(messages),
    ])
  );
}

function messageCount(client: any): number {
  return Array.from(client.messagesStore.values() as Iterable<unknown[]>).reduce(
    (total, bucket) => total + bucket.length,
    0
  );
}

function storeMessageSamplePercent(profile: CpuProfile): number {
  const samples = profile.samples ?? [];
  const timeDeltas = profile.timeDeltas ?? [];
  if (samples.length === 0 || samples.length !== timeDeltas.length) return 0;

  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map<number, number>();
  for (const node of profile.nodes) {
    for (const child of node.children ?? []) parents.set(child, node.id);
  }

  const belongsToStoreMessage = new Map<number, boolean>();
  const isStoreMessageSample = (nodeId: number): boolean => {
    const cached = belongsToStoreMessage.get(nodeId);
    if (cached !== undefined) return cached;

    let currentId: number | undefined = nodeId;
    while (currentId !== undefined) {
      if (nodes.get(currentId)?.callFrame.functionName === "storeMessage") {
        belongsToStoreMessage.set(nodeId, true);
        return true;
      }
      currentId = parents.get(currentId);
    }
    belongsToStoreMessage.set(nodeId, false);
    return false;
  };

  const totalMicros = timeDeltas.reduce((total, delta) => total + delta, 0);
  const storeMicros = samples.reduce(
    (total, nodeId, index) =>
      total + (isStoreMessageSample(nodeId) ? timeDeltas[index] : 0),
    0
  );
  return totalMicros === 0 ? 0 : (storeMicros / totalMicros) * 100;
}

async function measure(
  scenario: ScenarioName,
  trial: number,
  setup: () => ReturnType<typeof createBenchmarkClient>,
  operation: (
    context: ReturnType<typeof createBenchmarkClient>
  ) => void | Promise<void>
): Promise<TrialResult> {
  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  gc?.();
  const context = setup();
  const loopDelay = monitorEventLoopDelay({ resolution: 10 });
  const profiler = new Session();
  profiler.connect();
  await profilerPost(profiler, "Profiler.enable");
  loopDelay.enable();
  await delay(20);
  await profilerPost(profiler, "Profiler.start");

  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();
  await operation(context);
  await context.flushPendingCheckpoint();
  const wallMs = performance.now() - wallStart;
  const cpu = process.cpuUsage(cpuStart);

  const { profile } = await profilerPost<{ profile: CpuProfile }>(
    profiler,
    "Profiler.stop"
  );
  await delay(20);
  loopDelay.disable();
  profiler.disconnect();

  const writes = context.getWriteCount();
  const result: TrialResult = {
    scenario,
    trial,
    wallMs,
    cpuUserMs: cpu.user / 1000,
    cpuSystemMs: cpu.system / 1000,
    cpuTotalMs: (cpu.user + cpu.system) / 1000,
    eventLoopDelayMeanMs: loopDelay.mean / 1e6,
    eventLoopDelayP99Ms: loopDelay.percentile(99) / 1e6,
    eventLoopDelayMaxMs: loopDelay.max / 1e6,
    storeMessageSamplePercent: storeMessageSamplePercent(profile),
    writeCount: writes,
    writeBytes: context.getWriteBytes(),
    writeBytesMethod: "compact-checkpoint-payload",
    processPeakRssBytes: process.resourceUsage().maxRSS * 1024,
    finalMessageCount: messageCount(context.client),
  };

  context.client.messagesStore.clear();
  return result;
}

function historySetup(): ReturnType<typeof createBenchmarkClient> {
  return createBenchmarkClient();
}

function liveSetup(skewed: boolean): ReturnType<typeof createBenchmarkClient> {
  const context = createBenchmarkClient();
  preseed(context.client, skewed);
  return context;
}

function historyOperation(
  context: ReturnType<typeof createBenchmarkClient>
): void {
  const messages = Array.from({ length: HISTORY_MESSAGE_COUNT }, (_, index) =>
    rawMessage(`HISTORY-${index}`, index % CHAT_COUNT)
  );
  context.handlers["messaging-history.set"]({
    contacts: [],
    chats: [],
    messages,
    isLatest: true,
  });
}

async function liveOperation(
  context: ReturnType<typeof createBenchmarkClient>,
  skewed: boolean
): Promise<void> {
  const messages = Array.from({ length: LIVE_BURST_COUNT }, (_, index) =>
    rawMessage(
      `LIVE-${index}`,
      skewed ? 0 : index % CHAT_COUNT
    )
  );
  await context.handlers["messages.upsert"]({ type: "notify", messages });
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function printable(result: TrialResult): TrialResult {
  return Object.fromEntries(
    Object.entries(result).map(([key, value]) => [
      key,
      typeof value === "number" ? round(value) : value,
    ])
  ) as unknown as TrialResult;
}

async function run(): Promise<void> {
  console.log(
    JSON.stringify({
      type: "message-store-benchmark-config",
      nodeVersion: process.version,
      warmupRuns: WARMUP_RUNS,
      measuredRuns: MEASURED_RUNS,
      inputs: {
        historyMessages: HISTORY_MESSAGE_COUNT,
        distributedChats: CHAT_COUNT,
        preseededMessages: HISTORY_MESSAGE_COUNT,
        liveBurstMessages: LIVE_BURST_COUNT,
        payload: "fixed synthetic text message",
      },
      persistence: "stubbed; count and bytes reflect compact physical checkpoints",
      outputContainsMessageContentOrJids: false,
    })
  );

  const scenarios = [
    {
      name: "history-500-chats" as const,
      setup: historySetup,
      operation: historyOperation,
    },
    {
      name: "live-500-chats" as const,
      setup: () => liveSetup(false),
      operation: (context: ReturnType<typeof createBenchmarkClient>) =>
        liveOperation(context, false),
    },
    {
      name: "live-skewed-chat" as const,
      setup: () => liveSetup(true),
      operation: (context: ReturnType<typeof createBenchmarkClient>) =>
        liveOperation(context, true),
    },
  ];

  for (const scenario of scenarios) {
    for (let warmup = 0; warmup < WARMUP_RUNS; warmup++) {
      await measure(scenario.name, 0, scenario.setup, scenario.operation);
    }
  }

  const results: TrialResult[] = [];
  for (let trial = 1; trial <= MEASURED_RUNS; trial++) {
    for (const scenario of scenarios) {
      const result = await measure(
        scenario.name,
        trial,
        scenario.setup,
        scenario.operation
      );
      results.push(result);
      console.log(JSON.stringify({ type: "trial", ...printable(result) }));
    }
  }

  const distributed = results.filter(
    (result) => result.scenario === "live-500-chats"
  );
  const skewed = results.filter(
    (result) => result.scenario === "live-skewed-chat"
  );
  const distributedMedianWallMs = median(distributed.map((item) => item.wallMs));
  const skewedMedianWallMs = median(skewed.map((item) => item.wallMs));
  const skewRatio = skewedMedianWallMs / distributedMedianWallMs;
  const skewedMedianStoreSamplePercent = median(
    skewed.map((item) => item.storeMessageSamplePercent)
  );
  const ratioGatePassed = skewRatio >= 2;

  console.log(
    JSON.stringify({
      type: "summary",
      distributedMedianWallMs: round(distributedMedianWallMs),
      skewedMedianWallMs: round(skewedMedianWallMs),
      skewToDistributedRatio: round(skewRatio),
      skewedMedianStoreMessageSamplePercent: round(
        skewedMedianStoreSamplePercent
      ),
      lookupCostThresholds: {
        ratioThreshold: 2,
        ratioGatePassed,
        materialLookupCostObserved: ratioGatePassed,
      },
      storeMessageSamplePercentInformational: true,
    })
  );
}

await run();
