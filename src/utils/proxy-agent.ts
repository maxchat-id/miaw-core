import type { Agent } from "node:https";
import type { ProxyConfig } from "../types/index.js";

/**
 * Result of creating proxy agents for Baileys.
 * Baileys needs two separate agents:
 * - wsAgent: Node.js http.Agent for WebSocket connections (ws library)
 * - fetchAgent: undici Dispatcher for fetch() calls (media upload/download)
 */
export interface ProxyAgents {
  /** Agent for WebSocket connections (passed as `agent` to makeWASocket) */
  wsAgent: Agent;
  /** Dispatcher for fetch requests (passed as `fetchAgent` to makeWASocket) */
  fetchAgent: unknown;
}

// socks5h / socks4a resolve DNS *at the proxy*. Plain socks5 / socks4 resolve
// locally, which leaks the destination hostname to your DNS resolver even though
// the connection itself is tunnelled - use the h/a variants if that matters.
const SOCKS_PROTOCOLS = [
  "socks:",
  "socks4:",
  "socks4a:",
  "socks5:",
  "socks5h:",
];
const HTTP_PROTOCOLS = ["http:", "https:"];
const SUPPORTED_PROTOCOLS = [...SOCKS_PROTOCOLS, ...HTTP_PROTOCOLS];

/**
 * Builds a full proxy URL from a ProxyConfig or string.
 * Merges username/password from config fields into the URL if provided separately.
 */
function buildProxyUrl(config: ProxyConfig | string): string {
  if (typeof config === "string") {
    return config;
  }

  const url = new URL(config.url);
  if (config.username) {
    url.username = config.username;
  }
  if (config.password) {
    url.password = config.password;
  }
  return url.toString();
}

/**
 * Creates proxy agents for both WebSocket and fetch connections.
 *
 * - WebSocket agent: Works with all proxy types (HTTP, HTTPS, SOCKS4, SOCKS5)
 * - Fetch agent: Works with HTTP/HTTPS proxies only (undici limitation).
 *   For SOCKS proxies, fetchAgent will be undefined and media operations
 *   will use a direct connection.
 *
 * @param config - Proxy URL string or ProxyConfig object
 * @returns Object with wsAgent and fetchAgent
 */
export async function createProxyAgents(
  config: ProxyConfig | string
): Promise<ProxyAgents> {
  const proxyUrl = buildProxyUrl(config);
  const protocol = new URL(proxyUrl).protocol;

  if (!SUPPORTED_PROTOCOLS.includes(protocol)) {
    throw new Error(
      `Unsupported proxy protocol: ${protocol}. Supported: ${SUPPORTED_PROTOCOLS.join(", ")}`
    );
  }

  // Create WebSocket agent (works with all proxy types)
  let wsAgent: Agent;
  if (SOCKS_PROTOCOLS.includes(protocol)) {
    const { SocksProxyAgent } = await import("socks-proxy-agent");
    wsAgent = new SocksProxyAgent(proxyUrl);
  } else {
    const { HttpsProxyAgent } = await import("https-proxy-agent");
    wsAgent = new HttpsProxyAgent(proxyUrl);
  }

  // Create fetch agent (undici dispatcher - HTTP/HTTPS proxies only)
  let fetchAgent: unknown = undefined;
  if (HTTP_PROTOCOLS.includes(protocol)) {
    const { ProxyAgent: UndiciProxyAgent } = await import("undici");
    fetchAgent = new UndiciProxyAgent({ uri: proxyUrl });
  }

  return { wsAgent, fetchAgent };
}

/**
 * Masks the password in a proxy URL so it is safe to log or print.
 *
 * The username is preserved on purpose - proxy vendors commonly encode the
 * region or sticky-session id in it, which makes it useful for diagnostics.
 * Only the password is replaced.
 *
 * Never throws: an unparseable input is returned unchanged.
 *
 * @param config - Proxy URL string or ProxyConfig object
 * @returns The URL with the password replaced by "****"
 */
export function maskProxyUrl(config: ProxyConfig | string): string {
  const raw = typeof config === "string" ? config : config.url;

  try {
    const parsed = new URL(raw);
    if (typeof config !== "string" && config.password) {
      parsed.password = config.password;
    }
    if (typeof config !== "string" && config.username) {
      parsed.username = config.username;
    }
    if (parsed.password) {
      parsed.password = "****";
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}

/**
 * Validates a proxy configuration.
 * Checks that the URL is parseable and uses a supported protocol.
 *
 * @param config - Proxy URL string or ProxyConfig object
 * @returns true if valid, false otherwise
 */
export function validateProxyConfig(config: ProxyConfig | string): boolean {
  try {
    const url = typeof config === "string" ? config : config.url;
    const parsed = new URL(url);
    return SUPPORTED_PROTOCOLS.includes(parsed.protocol);
  } catch {
    return false;
  }
}
