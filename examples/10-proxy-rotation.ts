/**
 * Proxy Rotation Example (v1.10.0)
 *
 * Demonstrates connecting through proxies:
 * - A single proxy from an environment variable
 * - Loading a proxy list file and building a ProxyRotator
 * - Assigning each instance a STABLE proxy via the deterministic strategy
 * - Inspecting the active proxy with getProxyInfo() (credentials masked)
 * - Failing over when a proxy dies
 *
 * ⚠️  SOCKS caveat: SOCKS tunnels the WebSocket AND media uploads, but not
 * media DOWNLOADS. downloadMedia() uses native fetch(), which needs an undici
 * dispatcher, and undici has no SOCKS transport - so downloads fall back to a
 * DIRECT connection and reveal your real IP. Use an HTTP/HTTPS proxy if that
 * matters. See docs/PROXY.md.
 *
 * Setup:
 *   cp examples/proxies.example.txt ./proxies.txt   # then edit it
 *   # or: export MIAW_PROXY=socks5://user:pass@proxy.example.com:1080
 *
 * Test your proxies before running this:
 *   npx miaw-cli proxy test-all --proxy-file ./proxies.txt
 */

import {
  MiawClient,
  ProxyRotator,
  loadProxyList,
  maskProxyUrl,
} from "miaw-core";
import qrcode from "qrcode-terminal";

const PROXY_FILE = process.env.MIAW_PROXY_FILE || "./proxies.txt";

// ── 1. Single proxy from the environment ────────────────────────────────

async function singleProxyBot(): Promise<void> {
  const proxy = process.env.MIAW_PROXY;
  if (!proxy) {
    console.log("MIAW_PROXY not set - skipping the single-proxy example");
    return;
  }

  const client = new MiawClient({
    instanceId: "single-proxy-bot",
    sessionPath: "./sessions",
    proxy, // a URL string, or { url, username, password } if the password
           // contains @ : / ? # or %
  });

  client.on("qr", (qr) => qrcode.generate(qr, { small: true }));
  client.on("ready", () => {
    // Credentials are masked - safe to log.
    console.log("✅ Connected through", client.getProxyInfo()?.url);
  });

  await client.connect();
}

// ── 2. One proxy per instance, from a list file ─────────────────────────

async function multiInstanceBots(): Promise<void> {
  // `deterministic` is the default, and the only strategy safe for a
  // persisted WhatsApp session: it hashes the instanceId to a stable proxy,
  // so a given bot keeps the same egress IP across restarts.
  //
  // Rotation distributes instances across proxies. It NEVER rotates a live
  // session's IP - WhatsApp reads a session whose IP jumps between regions
  // as an account takeover, and you get re-pairing prompts, 401/440
  // disconnect loops, and eventually a ban.
  const rotator = await ProxyRotator.fromFile(PROXY_FILE, {
    strategy: "deterministic",
    watch: true, // hot-reload the file; affects FUTURE connections only
    onReload: (entries) => console.log(`🔄 Proxy pool reloaded: ${entries.length}`),
    onError: (error) => console.error("⚠️  Proxy reload failed:", error.message),
  });

  console.log("\nProxy pool:");
  console.table(rotator.getStats().proxies); // already masked

  const instanceIds = ["bot-1", "bot-2", "bot-3"];
  const clients: MiawClient[] = [];

  for (const instanceId of instanceIds) {
    const proxy = rotator.forInstance(instanceId);

    // Because selection uses rendezvous hashing, editing proxies.txt to
    // add or remove an UNRELATED proxy leaves this assignment untouched.
    console.log(`${instanceId} -> ${maskProxyUrl(proxy)}`);

    const client = new MiawClient({
      instanceId,
      sessionPath: "./sessions",
      proxy,
    });

    client.on("qr", (qr) => {
      console.log(`\nScan for ${instanceId}:`);
      qrcode.generate(qr, { small: true });
    });

    client.on("ready", () => {
      console.log(`✅ ${instanceId} ready via ${client.getProxyInfo()?.url}`);
    });

    clients.push(client);
  }

  await Promise.all(clients.map((c) => c.connect()));

  // Release the file watcher when you're done with the rotator.
  process.on("SIGINT", () => {
    rotator.close();
    process.exit(0);
  });
}

// ── 3. Failing over when a proxy dies ───────────────────────────────────

async function failoverExample(): Promise<void> {
  let pool = (await loadProxyList(PROXY_FILE)).map((entry) => entry.url);
  const rotator = new ProxyRotator({ proxies: pool, strategy: "deterministic" });

  const instanceId = "failover-bot";

  // ONE client for the lifetime of the process. Its auth state, instanceId,
  // stores and event handlers all survive disconnect() -> connect(), so there
  // is no reason to build a second one - and building a second one while this
  // is alive would put two writers on the same auth state.
  const client = new MiawClient({
    instanceId,
    sessionPath: "./sessions",
    proxy: rotator.forInstance(instanceId),
  });

  let consecutiveFailures = 0;
  let failingOver = false;

  client.on("ready", () => {
    consecutiveFailures = 0;
  });

  client.on("disconnected", async (reason) => {
    if (reason === "intentional") return;   // our own disconnect(), below
    if (failingOver) return;                // don't re-enter mid-failover

    // One blip is not a dead proxy. Reacting to every drop would permanently
    // evict a healthy entry the first time the network hiccups.
    if (++consecutiveFailures < 3) return;

    const current = client.getProxyInfo();
    if (!current) return;                   // direct, or a custom agent

    failingOver = true;
    try {
      // Drop the failing proxy and re-select from what remains. Removing one
      // entry only moves the instances that were on it - every other bot in
      // your fleet stays exactly where it was. Masking never touches the host.
      const deadHost = new URL(current.url).host;
      const remaining = pool.filter((url) => new URL(url).host !== deadHost);

      if (remaining.length === 0) {
        console.error("❌ No proxies left in the pool");
        return;
      }

      pool = remaining;
      rotator.setProxies(pool);
      const replacement = rotator.forInstance(instanceId);

      // Tear the old egress down BEFORE staging, so no in-flight reconnect can
      // pick the replacement up on a socket that is still half-alive.
      await client.disconnect();

      const result = client.setProxy(replacement);
      if (!result.success) {
        console.error(`❌ Proxy switch rejected: ${result.error}`);
        return;
      }
      console.warn(`⚠️  ${current.url} failed; switching to ${maskProxyUrl(replacement)}`);

      await client.connect();               // same session, no QR
      consecutiveFailures = 0;
    } finally {
      failingOver = false;
    }
  });

  await client.connect();
}

// ── Run ─────────────────────────────────────────────────────────────────

const mode = process.argv[2] || "multi";

switch (mode) {
  case "single":
    await singleProxyBot();
    break;
  case "failover":
    await failoverExample();
    break;
  case "multi":
  default:
    await multiInstanceBots();
    break;
}
