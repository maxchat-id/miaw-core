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
 * ⚠️  SOCKS caveat: SOCKS proxies tunnel the WebSocket but NOT media
 * transfers. Node's fetch() needs an undici dispatcher and undici has no
 * SOCKS transport, so sendImage/sendVideo/downloadMedia and friends fall
 * back to a DIRECT connection and reveal your real IP. Use an HTTP/HTTPS
 * proxy if that matters. See docs/PROXY.md.
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
  let client = new MiawClient({
    instanceId,
    sessionPath: "./sessions",
    proxy: rotator.forInstance(instanceId),
  });

  client.on("connection", async (state) => {
    if (state !== "disconnected") return;

    const current = client.getProxyInfo();
    if (!current) return;

    // Drop the failing proxy and re-select from what remains. Removing one
    // entry only moves the instances that were on it - every other bot in
    // your fleet stays exactly where it was.
    const deadHost = new URL(current.url).host;
    pool = pool.filter((url) => new URL(url).host !== deadHost);

    if (pool.length === 0) {
      console.error("❌ No proxies left in the pool");
      return;
    }

    rotator.setProxies(pool);
    const replacement = rotator.forInstance(instanceId);
    console.warn(`⚠️  ${current.url} failed; switching to ${maskProxyUrl(replacement)}`);

    // A client binds its agent at connect() time, so failing over means
    // building a new client rather than mutating this one.
    client = new MiawClient({
      instanceId,
      sessionPath: "./sessions",
      proxy: replacement,
    });
    await client.connect();
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
