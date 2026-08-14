import type { Agent } from "node:https";
import type { ProxyConfig } from "../types/index.js";

/**
 * Result of creating proxy agents for Baileys.
 *
 * Both are the SAME Node http.Agent, and that is deliberate. Baileys declares
 * `fetchAgent?: Agent` importing from 'https', and on Node its media upload
 * path (`uploadWithNodeHttp`) hands the value straight to `https.request({ agent })`.
 * Passing an undici Dispatcher there - which is what this code used to do -
 * makes every media upload through a proxy fail, because Node's https module
 * cannot use a Dispatcher.
 *
 * Consequence worth knowing: because a SocksProxyAgent is also an http.Agent,
 * media uploads are proxied for SOCKS too, not just HTTP/HTTPS.
 */
export interface ProxyAgents {
  /** Agent for WebSocket connections (passed as `agent` to makeWASocket) */
  wsAgent: Agent;
  /** Agent for media upload (passed as `fetchAgent` to makeWASocket) */
  fetchAgent: Agent;
  /**
   * undici Dispatcher for media *downloads*.
   *
   * Baileys downloads with `fetch(url, { dispatcher })`, and native fetch only
   * accepts an undici Dispatcher - an http.Agent is ignored there. undici ships
   * no SOCKS transport, so this is `undefined` for SOCKS proxies and their
   * downloads fall back to a direct connection.
   */
  downloadDispatcher?: unknown;
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
 * Creates the proxy agent Baileys needs, for every supported protocol.
 *
 * Returns the same http.Agent as both `wsAgent` and `fetchAgent`:
 *
 * - `wsAgent` carries the WebSocket (messages, presence, the whole session).
 * - `fetchAgent` carries **media uploads**. On Node, Baileys' upload path is
 *   `https.request({ agent })`, so this must be an http.Agent - an undici
 *   Dispatcher is silently unusable there and every upload fails.
 *
 * Media *downloads* are a separate story: Baileys fetches them with
 * `fetch(url, { dispatcher })` and never wires `fetchAgent` into it, so
 * downloads are not proxied for any protocol. That is an upstream gap, not
 * something this function can influence.
 *
 * @param config - Proxy URL string or ProxyConfig object
 * @returns Object with wsAgent and fetchAgent (the same agent instance)
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

  // One http.Agent serves both transports (works for all supported protocols).
  let wsAgent: Agent;
  if (SOCKS_PROTOCOLS.includes(protocol)) {
    const { SocksProxyAgent } = await import("socks-proxy-agent");
    wsAgent = new SocksProxyAgent(proxyUrl);
  } else {
    const { HttpsProxyAgent } = await import("https-proxy-agent");
    wsAgent = new HttpsProxyAgent(proxyUrl);
  }

  const fetchAgent: Agent = wsAgent;

  // Downloads go through native fetch, which only honours an undici Dispatcher.
  // undici has no SOCKS transport, so SOCKS downloads stay direct.
  let downloadDispatcher: unknown;
  if (HTTP_PROTOCOLS.includes(protocol)) {
    const { ProxyAgent: UndiciProxyAgent } = await import("undici");
    downloadDispatcher = new UndiciProxyAgent({ uri: proxyUrl });
  }

  return {
    wsAgent,
    fetchAgent,
    ...(downloadDispatcher !== undefined && { downloadDispatcher }),
  };
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
