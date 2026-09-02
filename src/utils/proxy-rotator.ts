/**
 * Proxy Rotator
 *
 * Selects a proxy from a pool using one of four strategies. Pure selection
 * logic - it reaches the filesystem only through proxy-loader.ts.
 *
 * The rotator returns a ProxyPoolEntry, which you pass straight to
 * `new MiawClient({ proxy })`. It deliberately does NOT return pre-built
 * agents: feeding `agent`/`fetchAgent` instead of `proxy` makes
 * MiawClient.resolveProxyAgents() take its early-return branch, which
 * silently disables getProxyInfo(), skips validation, and drops the
 * fetchAgent so all rotated media traffic goes direct. Returning a config
 * reuses the already-shipped proxy path instead.
 *
 * For the advanced case where you do want the agents:
 *   const agents = await createProxyAgents(rotator.forInstance(id));
 */

import { maskProxyUrl, validateProxyConfig } from "./proxy-agent.js";
import {
  loadProxyList,
  watchProxyList,
  type ProxyListWatcher,
  type ProxyParseOptions,
  type ProxyPoolEntry,
} from "./proxy-loader.js";

/**
 * How the rotator picks a proxy.
 *
 * - `round-robin`  - cycles through the pool in order
 * - `random`       - uniform random pick
 * - `weighted`     - random pick biased by each entry's weight
 * - `deterministic`- hashes the instanceId to a stable entry (see below)
 */
export type ProxyRotationStrategy =
  | "round-robin"
  | "random"
  | "weighted"
  | "deterministic";

export interface ProxyRotatorOptions {
  proxies: readonly (string | ProxyPoolEntry)[];
  /**
   * Default "deterministic" - a stable proxy per instanceId, which is the only
   * strategy safe for a long-lived WhatsApp session. Set "round-robin"
   * explicitly if you actually want to spread requests.
   */
  strategy?: ProxyRotationStrategy;
  /** Injectable RNG for tests and seeded determinism. Default Math.random. */
  random?: () => number;
}

export interface ProxyRotatorStats {
  total: number;
  /** Entries with weight > 0, i.e. selectable under the "weighted" strategy. */
  eligible: number;
  strategy: ProxyRotationStrategy;
  cursor: number;
  /** URLs are credential-masked - this exists to be printed. */
  proxies: Array<{ url: string; weight: number; label?: string }>;
}

export interface ProxyRotatorFromFileOptions {
  strategy?: ProxyRotationStrategy;
  /** Watch the file and hot-reload the pool on change. */
  watch?: boolean;
  /** fs.watchFile poll interval in ms. Default 2000. */
  watchInterval?: number;
  parse?: ProxyParseOptions;
  /** Called after a successful hot reload. */
  onReload?: (entries: ProxyPoolEntry[]) => void;
  /** Called when a hot reload fails. The previous pool is retained. */
  onError?: (error: Error) => void;
  random?: () => number;
}

/**
 * FNV-1a, 32-bit.
 *
 * Chosen over a Java-style hashCode because rendezvous hashing needs decent
 * avalanche: weakly-mixed hashes produce correlated scores across entries
 * and an uneven instance distribution. Also avoids the `|0` + Math.abs
 * sign-handling trap.
 */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // hash * 16777619 without overflowing into float territory
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The credential-stripped identity of a proxy: protocol//host:port.
 *
 * Rotating a proxy's password in the file must not remap instances, so
 * credentials are excluded from the key.
 */
function proxyKey(entry: ProxyPoolEntry): string {
  try {
    const url = new URL(entry.url);
    return `${url.protocol}//${url.host}`;
  } catch {
    return entry.url;
  }
}

function normalize(entry: string | ProxyPoolEntry): ProxyPoolEntry {
  return typeof entry === "string" ? { url: entry } : { ...entry };
}

function weightOf(entry: ProxyPoolEntry): number {
  return entry.weight ?? 1;
}

export class ProxyRotator {
  readonly strategy: ProxyRotationStrategy;

  private proxies: ProxyPoolEntry[] = [];
  private readonly random: () => number;
  private cursor = 0;
  /** Key of the entry most recently served by round-robin, for reload continuity. */
  private lastServedKey: string | undefined;
  /** Indices into `proxies` with weight > 0. */
  private eligible: number[] = [];
  /** Cumulative weights over `eligible`, precomputed to keep selection O(n). */
  private prefixSums: number[] = [];
  private watcher: ProxyListWatcher | undefined;

  /** Whether `strategy` came from the default, for a clearer next() error. */
  private strategyWasDefaulted = false;

  constructor(options: ProxyRotatorOptions | readonly (string | ProxyPoolEntry)[]) {
    const resolved: ProxyRotatorOptions = Array.isArray(options)
      ? { proxies: options as readonly (string | ProxyPoolEntry)[] }
      : (options as ProxyRotatorOptions);

    // Defaults to deterministic, matching the documented behaviour and, more
    // importantly, failing safe: round-robin here would hand a long-lived
    // session a different egress IP on each call, which WhatsApp reads as
    // account takeover.
    this.strategy = resolved.strategy ?? "deterministic";
    this.strategyWasDefaulted = resolved.strategy === undefined;
    this.random = resolved.random ?? Math.random;
    this.setProxies(resolved.proxies);
  }

  /** Number of proxies in the pool. */
  get size(): number {
    return this.proxies.length;
  }

  /**
   * Replaces the pool.
   *
   * Round-robin position is carried across: the cursor resumes after the
   * entry it last served rather than resetting to 0, which would make every
   * hot reload hammer the first proxy.
   *
   * @throws if the list is empty, or if any weight is invalid
   */
  setProxies(proxies: readonly (string | ProxyPoolEntry)[]): void {
    const entries = proxies.map(normalize);

    if (entries.length === 0) {
      throw new Error("ProxyRotator requires at least one proxy");
    }

    for (const entry of entries) {
      const weight = weightOf(entry);
      if (!Number.isFinite(weight) || weight < 0) {
        throw new Error(
          `Invalid proxy weight ${String(entry.weight)} for ${maskProxyUrl(entry)}: must be a finite number >= 0`
        );
      }
      if (!validateProxyConfig(entry)) {
        throw new Error(`Invalid proxy in pool: ${maskProxyUrl(entry)}`);
      }
    }

    const eligible: number[] = [];
    const prefixSums: number[] = [];
    let running = 0;
    for (let i = 0; i < entries.length; i++) {
      const weight = weightOf(entries[i]);
      if (weight > 0) {
        running += weight;
        eligible.push(i);
        prefixSums.push(running);
      }
    }

    if (this.strategy === "weighted" && eligible.length === 0) {
      throw new Error(
        "weighted strategy requires at least one proxy with weight > 0"
      );
    }

    // Resume round-robin after the previously served entry if it survived.
    if (this.lastServedKey !== undefined) {
      const previous = entries.findIndex((e) => proxyKey(e) === this.lastServedKey);
      this.cursor = previous === -1 ? this.cursor % entries.length : previous + 1;
    }

    this.proxies = entries;
    this.eligible = eligible;
    this.prefixSums = prefixSums;
  }

  /**
   * Selects a proxy according to the configured strategy.
   *
   * @param instanceId - required when the strategy is "deterministic"
   */
  next(instanceId?: string): ProxyPoolEntry {
    if (this.proxies.length === 0) {
      throw new Error("ProxyRotator pool is empty");
    }

    switch (this.strategy) {
      case "deterministic":
        if (!instanceId) {
          throw new Error(
            this.strategyWasDefaulted
              ? 'ProxyRotator defaults to the "deterministic" strategy, which needs an instanceId: call next(instanceId) or forInstance(instanceId), or pass { strategy: "round-robin" } explicitly.'
              : 'The "deterministic" strategy requires an instanceId: call next(instanceId) or forInstance(instanceId)'
          );
        }
        return this.forInstance(instanceId);

      case "random":
        return this.proxies[Math.floor(this.random() * this.proxies.length)];

      case "weighted":
        return this.weightedPick();

      case "round-robin":
      default: {
        const entry = this.proxies[this.cursor % this.proxies.length];
        this.cursor = (this.cursor + 1) % this.proxies.length;
        this.lastServedKey = proxyKey(entry);
        return entry;
      }
    }
  }

  /**
   * Maps an instanceId to a stable proxy, regardless of the configured
   * strategy.
   *
   * Uses rendezvous (highest-random-weight) hashing rather than
   * `hash % length`. With modulo, adding or removing one proxy remaps
   * roughly every instance - so a routine edit to the proxy file would
   * change the egress IP of every live WhatsApp session at once, which is
   * exactly the churn that gets accounts flagged. Rendezvous hashing
   * remaps only the instances that were on the removed entry, and is
   * independent of the order lines appear in the file.
   */
  forInstance(instanceId: string): ProxyPoolEntry {
    if (this.proxies.length === 0) {
      throw new Error("ProxyRotator pool is empty");
    }

    let bestIndex = 0;
    let bestScore = -1;

    for (let i = 0; i < this.proxies.length; i++) {
      const score = fnv1a32(`${instanceId} ${proxyKey(this.proxies[i])}`);
      // Strict > breaks ties by lowest index, keeping duplicate URLs deterministic.
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    return this.proxies[bestIndex];
  }

  /**
   * Weighted random selection over the eligible (weight > 0) subset.
   *
   * Uses a precomputed prefix-sum scan rather than accumulate-and-subtract:
   * the latter can fall through on floating-point error and return the last
   * entry even when that entry is drained.
   */
  private weightedPick(): ProxyPoolEntry {
    if (this.eligible.length === 0) {
      throw new Error(
        "weighted strategy requires at least one proxy with weight > 0"
      );
    }

    const total = this.prefixSums[this.prefixSums.length - 1];
    const target = this.random() * total;

    for (let i = 0; i < this.prefixSums.length; i++) {
      if (target < this.prefixSums[i]) {
        return this.proxies[this.eligible[i]];
      }
    }

    // Floating-point fallthrough: use the last ELIGIBLE entry, never a drained one.
    return this.proxies[this.eligible[this.eligible.length - 1]];
  }

  /**
   * Pool summary for display. URLs are credential-masked.
   */
  getStats(): ProxyRotatorStats {
    return {
      total: this.proxies.length,
      eligible: this.eligible.length,
      strategy: this.strategy,
      cursor: this.cursor,
      proxies: this.proxies.map((entry) => ({
        url: maskProxyUrl(entry),
        weight: weightOf(entry),
        ...(entry.label !== undefined && { label: entry.label }),
      })),
    };
  }

  /**
   * Stops the file watcher created by fromFile({ watch: true }). Idempotent.
   */
  close(): void {
    this.watcher?.close();
    this.watcher = undefined;
  }

  /**
   * Builds a rotator from a proxy list file, optionally hot-reloading it.
   */
  static async fromFile(
    filePath: string,
    options: ProxyRotatorFromFileOptions = {}
  ): Promise<ProxyRotator> {
    const entries = await loadProxyList(filePath, options.parse);

    const rotator = new ProxyRotator({
      proxies: entries,
      ...(options.strategy && { strategy: options.strategy }),
      ...(options.random && { random: options.random }),
    });

    if (options.watch) {
      rotator.watcher = watchProxyList(
        filePath,
        (reloaded) => {
          try {
            rotator.setProxies(reloaded);
            options.onReload?.(reloaded);
          } catch (error) {
            // A bad reload must never take down the running pool.
            options.onError?.(
              error instanceof Error ? error : new Error(String(error))
            );
          }
        },
        {
          ...(options.watchInterval !== undefined && {
            interval: options.watchInterval,
          }),
          ...(options.parse && { parse: options.parse }),
          ...(options.onError && { onError: options.onError }),
        }
      );
    }

    return rotator;
  }
}
