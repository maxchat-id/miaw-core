/**
 * Proxy Commands
 *
 * Inspect and test proxies. None of these commands require a WhatsApp
 * connection - they probe the proxy directly, which is the point: you can
 * validate a proxy before spending a pairing attempt on it.
 */

import * as https from "node:https";
import type { Agent } from "node:https";
import { performance } from "node:perf_hooks";
import {
  createProxyAgents,
  maskProxyUrl,
  validateProxyConfig,
} from "../../utils/proxy-agent.js";
import { loadProxyList, type ProxyPoolEntry } from "../../utils/proxy-loader.js";
import { formatTable } from "../utils/formatter.js";
import { getErrorMessage } from "../../utils/type-guards.js";

/** What we probe. Any HTTP response proves the tunnel works. */
const TEST_TARGET = "https://web.whatsapp.com/";
/** Used only by --ip, and only when the user asks for it. */
const IP_ECHO_TARGET = "https://api.ipify.org";
const DEFAULT_TIMEOUT_MS = 10000;
/** Concurrency for test-all: enough to be fast, low enough not to trip provider rate limits. */
const TEST_ALL_CONCURRENCY = 5;

export interface ProxyProbeResult {
  /** Credential-masked. */
  url: string;
  protocol: string;
  ok: boolean;
  latencyMs: number | null;
  status: number | null;
  /**
   * Whether media *downloads* would also go through this proxy.
   *
   * Computed, not probed. Uploads are proxied for every supported protocol
   * (they use a Node http.Agent). Downloads go through native fetch, which
   * needs an undici Dispatcher, and undici has no SOCKS transport - so SOCKS
   * downloads fall back to a direct connection.
   */
  downloadProxied: boolean;
  exitIp: string | null;
  error: { code: string | null; message: string } | null;
}

/**
 * Strips a proxy URL's password out of arbitrary error text.
 *
 * The proxy-agent libraries sometimes embed the full URL in their errors.
 */
function scrub(message: string, rawUrl: string): string {
  let password = "";
  try {
    password = new URL(rawUrl).password;
  } catch {
    /* not parseable, nothing to scrub */
  }
  let scrubbed = message.split(rawUrl).join(maskProxyUrl(rawUrl));
  if (password) {
    scrubbed = scrubbed.split(password).join("****");
  }
  return scrubbed;
}

/**
 * Issues one request through a proxy agent and resolves with the status code.
 *
 * Uses https.request rather than fetch + dispatcher on purpose. The undici
 * dispatcher path only supports HTTP/HTTPS proxies, and it exercises the
 * media transport rather than the one that matters. The wsAgent is an
 * http.Agent subclass for all four protocols, so this single code path
 * covers SOCKS too - and it is the exact agent Baileys will use for the
 * WebSocket.
 */
function requestThrough(
  target: string,
  agent: Agent,
  timeoutMs: number,
  method: "HEAD" | "GET" = "HEAD"
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(target, { method, agent }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        if (method === "GET") chunks.push(chunk);
      });
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf-8").trim(),
        })
      );
      res.on("error", reject);
    });

    // https.request's `timeout` option only covers socket inactivity, so a
    // proxy that accepts the connection and then stalls would hang forever.
    // Add a hard deadline on top.
    const hardDeadline = setTimeout(() => {
      req.destroy(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Socket timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.on("close", () => clearTimeout(hardDeadline));
    req.end();
  });
}

/**
 * Tests one proxy's reachability and latency.
 *
 * Never throws - failures come back as `ok: false` with a scrubbed error.
 */
export async function probeProxy(
  rawUrl: string,
  options: { timeoutMs?: number; showIp?: boolean } = {}
): Promise<ProxyProbeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const masked = maskProxyUrl(rawUrl);

  // Validate before opening anything - never dial ftp://.
  if (!validateProxyConfig(rawUrl)) {
    let protocol = "unknown";
    try {
      protocol = new URL(rawUrl).protocol.replace(":", "");
    } catch {
      /* keep "unknown" */
    }
    return {
      url: masked,
      protocol,
      ok: false,
      latencyMs: null,
      status: null,
      downloadProxied: false,
      exitIp: null,
      error: {
        code: "EPROTONOSUPPORT",
        message:
          "Unsupported proxy protocol. Supported: http, https, socks4, socks4a, socks5, socks5h",
      },
    };
  }

  const protocol = new URL(rawUrl).protocol.replace(":", "");
  const downloadProxied = protocol === "http" || protocol === "https";

  let agent: Agent | undefined;
  try {
    ({ wsAgent: agent } = await createProxyAgents(rawUrl));
  } catch (error) {
    return {
      url: masked,
      protocol,
      ok: false,
      latencyMs: null,
      status: null,
      downloadProxied,
      exitIp: null,
      error: { code: null, message: scrub(getErrorMessage(error), rawUrl) },
    };
  }

  const start = performance.now();
  try {
    const { status } = await requestThrough(TEST_TARGET, agent, timeoutMs);
    const latencyMs = Math.round(performance.now() - start);

    // 407 comes from the PROXY, not the target: the tunnel was refused, so no
    // traffic ever reached WhatsApp. Reporting this as reachable would make
    // `proxy test-all` green-light a list with bad credentials - exactly the
    // pre-flight check it exists to provide.
    if (status === 407) {
      return {
        url: masked,
        protocol,
        ok: false,
        latencyMs,
        status,
        downloadProxied,
        exitIp: null,
        error: {
          code: "EPROXYAUTH",
          message:
            "407 Proxy Authentication Required - the proxy rejected these credentials",
        },
      };
    }

    let exitIp: string | null = null;
    if (options.showIp) {
      try {
        const echo = await requestThrough(IP_ECHO_TARGET, agent, timeoutMs, "GET");
        exitIp = echo.body || null;
      } catch {
        exitIp = null;
      }
    }

    // Any HTTP status means the CONNECT tunnel or SOCKS handshake completed,
    // which is what we set out to measure. Whether WhatsApp likes the IP is
    // a separate question this probe cannot answer.
    return {
      url: masked,
      protocol,
      ok: true,
      latencyMs,
      status,
      downloadProxied,
      exitIp,
      error: null,
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : null;
    return {
      url: masked,
      protocol,
      ok: false,
      latencyMs: null,
      status: null,
      downloadProxied,
      exitIp: null,
      error: { code, message: scrub(getErrorMessage(error), rawUrl) },
    };
  } finally {
    // Mandatory: a lingering agent keeps sockets open and the CLI never exits.
    agent?.destroy();
  }
}

/**
 * Shows the proxies parsed out of a proxy list file.
 */
export async function cmdProxyList(
  proxyFile: string | undefined,
  jsonOutput: boolean
): Promise<boolean> {
  if (!proxyFile) {
    console.log("❌ No proxy file configured.");
    console.log(
      "   Pass --proxy-file <path> or set MIAW_PROXY_FILE in your environment."
    );
    return false;
  }

  const errors: Array<{ line: number; reason: string; masked: string }> = [];
  let entries: ProxyPoolEntry[];

  try {
    // Non-strict so one bad line doesn't hide the rest of the file.
    entries = await loadProxyList(proxyFile, {
      strict: false,
      onInvalid: (info) => errors.push(info),
    });
  } catch (error) {
    console.log(`❌ ${getErrorMessage(error)}`);
    return false;
  }

  const format = proxyFile.toLowerCase().endsWith(".json") ? "json" : "txt";
  const byProtocol: Record<string, number> = {};

  const rows = entries.map((entry, index) => {
    const parsed = new URL(entry.url);
    const protocol = parsed.protocol.replace(":", "");
    byProtocol[protocol] = (byProtocol[protocol] ?? 0) + 1;

    return {
      index,
      url: maskProxyUrl(entry),
      protocol,
      host: parsed.hostname,
      port: Number(parsed.port) || null,
      hasAuth: Boolean(parsed.username || entry.username),
      weight: entry.weight ?? 1,
      label: entry.label ?? null,
      valid: true,
      downloadProxied: protocol === "http" || protocol === "https",
    };
  });

  if (jsonOutput) {
    console.log(
      JSON.stringify(
        {
          file: proxyFile,
          format,
          count: rows.length,
          valid: rows.length,
          invalid: errors.length,
          byProtocol,
          proxies: rows,
          errors: errors.map((e) => ({
            line: e.line,
            raw: e.masked,
            error: e.reason,
          })),
        },
        null,
        2
      )
    );
    return true;
  }

  console.log(`\n📄 ${proxyFile} (${format})\n`);

  if (rows.length > 0) {
    console.log(
      formatTable(
        rows.map((r) => ({
          ...r,
          auth: r.hasAuth ? "Yes" : "No",
          media: r.downloadProxied ? "Proxied" : "DL direct",
          label: r.label ?? "-",
        })),
        [
          { key: "index", label: "#", width: 5 },
          { key: "url", label: "Proxy", width: 44 },
          { key: "protocol", label: "Protocol", width: 11 },
          { key: "auth", label: "Auth", width: 7 },
          { key: "weight", label: "Weight", width: 9 },
          { key: "media", label: "Media", width: 10 },
          { key: "label", label: "Label", width: 12 },
        ]
      )
    );
  }

  if (errors.length > 0) {
    console.log(`\n⚠️  ${errors.length} invalid entr${errors.length === 1 ? "y" : "ies"} skipped:\n`);
    console.log(
      formatTable(
        errors.map((e) => ({ line: e.line, raw: e.masked, error: e.reason })),
        [
          { key: "line", label: "Line", width: 8 },
          { key: "raw", label: "Entry", width: 40 },
          { key: "error", label: "Reason", width: 40 },
        ]
      )
    );
  }

  const protocols = Object.entries(byProtocol)
    .map(([name, count]) => `${count} ${name}`)
    .join(", ");
  console.log(
    `\n✅ ${rows.length} ${rows.length === 1 ? "proxy" : "proxies"} loaded${protocols ? ` (${protocols})` : ""}`
  );

  const socksCount = rows.filter((r) => !r.downloadProxied).length;
  if (socksCount > 0) {
    console.log(
      `⚠️  ${socksCount} SOCKS prox${socksCount === 1 ? "y" : "ies"}: media DOWNLOADS use a direct connection (uploads are proxied; see docs/PROXY.md)`
    );
  }

  return true;
}

/**
 * Renders one probe result in human form.
 */
function printProbe(result: ProxyProbeResult): void {
  if (result.ok) {
    console.log(`✅ ${result.url}`);
    console.log(`   Protocol: ${result.protocol}`);
    console.log(`   Latency:  ${result.latencyMs}ms (HTTP ${result.status})`);
    if (result.exitIp) {
      console.log(`   Exit IP:  ${result.exitIp}`);
    }
    if (!result.downloadProxied) {
      console.log(
        "   ⚠️  Media DOWNLOADS will use a direct connection (undici has no SOCKS transport)"
      );
    }
  } else {
    console.log(`❌ ${result.url}`);
    console.log(`   Protocol: ${result.protocol}`);
    console.log(
      `   Error:    ${result.error?.code ? `${result.error.code} - ` : ""}${result.error?.message ?? "unknown"}`
    );
  }
}

/**
 * Tests a single proxy.
 */
export async function cmdProxyTest(
  url: string | undefined,
  options: { showIp?: boolean; timeoutMs?: number },
  jsonOutput: boolean
): Promise<boolean> {
  if (!url) {
    console.log("❌ Usage: miaw-cli proxy test <url> [--ip] [--timeout MS]");
    console.log("   Or set a proxy with --proxy <url>.");
    return false;
  }

  if (!jsonOutput) {
    console.error(`🔍 Testing proxy via ${TEST_TARGET} ...`);
  }
  const result = await probeProxy(url, options);

  if (jsonOutput) {
    console.log(JSON.stringify({ ...result, target: TEST_TARGET }, null, 2));
    return result.ok;
  }

  console.log("");
  printProbe(result);
  return result.ok;
}

/**
 * Runs `probeProxy` over a list with bounded concurrency.
 */
async function probeAll(
  urls: string[],
  options: { showIp?: boolean; timeoutMs?: number }
): Promise<ProxyProbeResult[]> {
  const results: ProxyProbeResult[] = [];

  for (let i = 0; i < urls.length; i += TEST_ALL_CONCURRENCY) {
    const chunk = urls.slice(i, i + TEST_ALL_CONCURRENCY);
    results.push(...(await Promise.all(chunk.map((u) => probeProxy(u, options)))));
  }

  return results;
}

/**
 * Tests every proxy in a list file.
 *
 * Returns false if any proxy fails, so it can gate a deploy.
 */
export async function cmdProxyTestAll(
  proxyFile: string | undefined,
  options: { showIp?: boolean; timeoutMs?: number },
  jsonOutput: boolean
): Promise<boolean> {
  if (!proxyFile) {
    console.log("❌ No proxy file configured.");
    console.log(
      "   Pass --proxy-file <path> or set MIAW_PROXY_FILE in your environment."
    );
    return false;
  }

  let entries: ProxyPoolEntry[];
  try {
    entries = await loadProxyList(proxyFile, { strict: false });
  } catch (error) {
    console.log(`❌ ${getErrorMessage(error)}`);
    return false;
  }

  if (entries.length === 0) {
    console.log(`❌ No valid proxies found in ${proxyFile}`);
    return false;
  }

  if (!jsonOutput) {
    console.error(
      `🔍 Testing ${entries.length} proxies via ${TEST_TARGET} (${TEST_ALL_CONCURRENCY} at a time) ...`
    );
  }

  const results = await probeAll(
    entries.map((e) => e.url),
    options
  );

  // Fastest first, failures last.
  results.sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? -1 : 1;
    return (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity);
  });

  const okResults = results.filter((r) => r.ok);
  const latencies = okResults
    .map((r) => r.latencyMs ?? 0)
    .sort((a, b) => a - b);
  const medianLatencyMs =
    latencies.length > 0 ? latencies[Math.floor(latencies.length / 2)] : null;

  if (jsonOutput) {
    console.log(
      JSON.stringify(
        {
          file: proxyFile,
          target: TEST_TARGET,
          tested: results.length,
          ok: okResults.length,
          failed: results.length - okResults.length,
          medianLatencyMs,
          results,
        },
        null,
        2
      )
    );
    return okResults.length === results.length;
  }

  console.log("");
  console.log(
    formatTable(
      results.map((r) => ({
        status: r.ok ? "OK" : "FAIL",
        url: r.url,
        protocol: r.protocol,
        latency: r.ok ? `${r.latencyMs}ms` : "-",
        detail: r.ok
          ? `HTTP ${r.status}${r.downloadProxied ? "" : " (dl direct)"}`
          : (r.error?.code ?? r.error?.message ?? "unknown"),
      })),
      [
        { key: "status", label: "Status", width: 9 },
        { key: "url", label: "Proxy", width: 40 },
        { key: "protocol", label: "Protocol", width: 11 },
        { key: "latency", label: "Latency", width: 10 },
        { key: "detail", label: "Detail", width: 30 },
      ]
    )
  );

  const failed = results.length - okResults.length;
  console.log(
    `\n${failed === 0 ? "✅" : "⚠️ "} ${okResults.length}/${results.length} proxies reachable${
      medianLatencyMs !== null ? ` (median ${medianLatencyMs}ms)` : ""
    }`
  );

  return failed === 0;
}
