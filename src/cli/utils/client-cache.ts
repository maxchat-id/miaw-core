/**
 * Client Cache Manager
 *
 * Caches MiawClient instances to avoid reconnecting on every command.
 * Key format: `${instanceId}:${sessionPath}`
 */

import { MiawClient } from "../../index.js";
import { createClient, type ClientConfig } from "./session.js";
import { registerInstance, unregisterInstance } from "./instance-registry.js";
import { TIMEOUTS } from "../../constants/timeouts.js";
import { maskProxyUrl } from "../../utils/proxy-agent.js";

// Client cache: Map<cacheKey, MiawClient>
const clientCache = new Map<string, MiawClient>();

// Track last usage time for potential TTL eviction (future enhancement)
const lastUsed = new Map<string, number>();

// Track when clients were cached (for grace period check)
const cachedTime = new Map<string, number>();

// Which proxy each cached client was actually BUILT with. Raw URLs, so this
// map is never printed and never leaks into getCacheStats().
//
// Deliberately a side map rather than part of the cache key: keying on proxy
// would let one instance hold two entries, i.e. two MiawClients and two live
// sockets for a single WhatsApp account - which is the very takeover signature
// the per-instance proxy work exists to avoid.
const proxyIdentity = new Map<string, string>();

/** "" means the client was built for a direct connection. */
function proxyIdOf(config: ClientConfig): string {
  return config.proxy ?? "";
}

function describeProxyId(id: string): string {
  return id ? maskProxyUrl(id) : "a direct connection";
}

function forgetCacheEntry(key: string): void {
  clientCache.delete(key);
  lastUsed.delete(key);
  cachedTime.delete(key);
  proxyIdentity.delete(key);
}

/**
 * Generate cache key from client config
 */
function getCacheKey(config: ClientConfig): string {
  return `${config.instanceId}:${config.sessionPath}`;
}

/**
 * Get existing client from cache or create new one
 */
export function getOrCreateClient(config: ClientConfig): MiawClient {
  const key = getCacheKey(config);

  // Check cache for existing client
  const cached = clientCache.get(key);
  if (cached) {
    const state = cached.getConnectionState();
    const cacheTime = cachedTime.get(key) || 0;
    const age = Date.now() - cacheTime;

    // A cached client keeps the agent it was constructed with, so handing back
    // one built for a different proxy would silently route this command through
    // the wrong egress IP - or through none at all.
    //
    // Checked BEFORE the grace-period return below: otherwise a proxy change
    // within CACHE_GRACE_PERIOD of caching would be ignored without a word.
    const wantProxy = proxyIdOf(config);
    const haveProxy = proxyIdentity.get(key) ?? "";

    if (wantProxy !== haveProxy) {
      // Never rebuild a client that still holds a socket: dropping a live
      // connection mid-command is worse than the stale proxy, and rebuilding
      // during pairing throws away a QR already on screen.
      if (state !== "disconnected") {
        console.log(
          `⚠️  "${config.instanceId}" is connected through ${describeProxyId(haveProxy)}; ` +
            `${describeProxyId(wantProxy)} applies on the next connect.`
        );
        lastUsed.set(key, Date.now());
        return cached;
      }

      console.log(
        `⚠️  Rebuilding "${config.instanceId}" for ${describeProxyId(wantProxy)} ` +
          `(was ${describeProxyId(haveProxy)}).`
      );
      unregisterInstance(config);
      forgetCacheEntry(key);
      return createAndCache(key, config);
    }

    // Within grace period, always return cached client regardless of state
    // This allows transient disconnects during and after QR connection handshake
    if (age < TIMEOUTS.CACHE_GRACE_PERIOD) {
      lastUsed.set(key, Date.now());
      return cached;
    }

    // After grace period, prefer clients in good states
    if (state === "connected" || state === "connecting" || state === "reconnecting") {
      lastUsed.set(key, Date.now());
      return cached;
    }

    // Don't evict - return cached client even in bad state
    // Let explicit cleanup (disconnectClient) handle eviction
    // This prevents cache churn during transient state changes
    lastUsed.set(key, Date.now());
    return cached;
  }

  return createAndCache(key, config);
}

/** Construct, cache, and register a client, recording which proxy built it. */
function createAndCache(key: string, config: ClientConfig): MiawClient {
  const client = createClient(config);
  clientCache.set(key, client);
  lastUsed.set(key, Date.now());
  cachedTime.set(key, Date.now()); // Track cache time for grace period
  proxyIdentity.set(key, proxyIdOf(config));

  // Register with instance registry for state tracking
  registerInstance(config, client);

  return client;
}

/**
 * Read the cache without creating, rebuilding, or warning.
 *
 * For inspection paths (`instance status`) that must not trip the proxy
 * mismatch check just by looking.
 */
export function peekClient(config: ClientConfig): MiawClient | null {
  return clientCache.get(getCacheKey(config)) ?? null;
}

/**
 * Disconnect and remove specific client from cache
 */
export async function disconnectClient(config: ClientConfig): Promise<void> {
  const key = getCacheKey(config);
  const client = clientCache.get(key);

  if (client && client.getConnectionState() === "connected") {
    await client.disconnect();
  }

  // Unregister from instance registry
  unregisterInstance(config);

  forgetCacheEntry(key);
}

/**
 * Disconnect all cached clients and clear cache
 */
export async function disconnectAll(): Promise<void> {
  const disconnectPromises: Promise<void>[] = [];

  for (const [key, client] of clientCache.entries()) {
    if (client.getConnectionState() === "connected") {
      disconnectPromises.push(
        client.disconnect().catch((err) => {
          // Log but don't fail if disconnect fails
          console.error(`Error disconnecting client ${key}:`, err);
        })
      );
    }
  }

  await Promise.all(disconnectPromises);

  // Unregister all from instance registry
  for (const key of clientCache.keys()) {
    const [instanceId, sessionPath] = key.split(":");
    unregisterInstance({ instanceId, sessionPath });
  }

  clientCache.clear();
  lastUsed.clear();
  cachedTime.clear();
  proxyIdentity.clear();
}

/**
 * Get cache statistics (for debugging)
 */
export function getCacheStats(): {
  size: number;
  keys: string[];
  clients: Array<{ key: string; state: string; proxy: string | null }>;
} {
  const clients: Array<{ key: string; state: string; proxy: string | null }> = [];

  for (const [key, client] of clientCache.entries()) {
    const id = proxyIdentity.get(key) ?? "";
    clients.push({
      key,
      state: client.getConnectionState(),
      // Masked: these stats surface in debug output and tests.
      proxy: id ? maskProxyUrl(id) : null,
    });
  }

  return {
    size: clientCache.size,
    keys: Array.from(clientCache.keys()),
    clients,
  };
}

/**
 * Check if specific client is in cache
 */
export function hasClient(config: ClientConfig): boolean {
  return clientCache.has(getCacheKey(config));
}

/**
 * Remove specific client from cache without disconnecting
 * (Useful when client is already disconnected externally)
 */
export function removeClient(config: ClientConfig): void {
  const key = getCacheKey(config);

  // Unregister from instance registry
  unregisterInstance(config);

  forgetCacheEntry(key);
}
