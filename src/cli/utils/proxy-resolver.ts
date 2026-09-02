/**
 * Per-Instance Proxy Precedence
 *
 * The single place that decides which proxy an instance connects through.
 * Everything that constructs a client - the CLI entry point, the `instance`
 * command block, the REPL's instance switches - resolves here first, so a
 * command targeting `bot-3` gets *bot-3's* proxy rather than whichever one the
 * process happened to start with.
 *
 * Precedence, highest first:
 *   1. --proxy / MIAW_PROXY        - always wins, warns when it shadows a pin
 *   2. a pin in instances.json     - per-instance, persistent, no flags needed
 *   3. --proxy-file + strategy     - hashed on the TARGET instanceId
 *   4. direct
 *
 * Resolution is async (it may read a proxy list file), which is why it happens
 * at these boundaries and never inside the synchronous client cache. The cache
 * only ever compares what it was handed.
 */

import { maskProxyUrl } from "../../utils/proxy-agent.js";
import { loadProxyList } from "../../utils/proxy-loader.js";
import { ProxyRotator, type ProxyRotationStrategy } from "../../utils/proxy-rotator.js";
import { DEFAULT_PROXY_STRATEGY, selectProxyForInstance } from "./proxy-config.js";
import { describePin, getPinnedProxy } from "./instance-config.js";
import type { ClientConfig } from "./session.js";

/** Where a resolved proxy came from. Drives the wording of status output. */
export type ProxySource = "flag" | "pin" | "pin-label" | "file" | "none";

/** The inputs precedence is applied to. Independent of any one instance. */
export interface ProxyResolutionBase {
  sessionPath: string;
  debug?: boolean;
  /** --proxy / MIAW_PROXY, verbatim. */
  explicitProxy?: string;
  /** --proxy-file / MIAW_PROXY_FILE. */
  proxyFile?: string;
  proxyStrategy?: ProxyRotationStrategy;
}

export interface ResolvedProxy {
  /** Raw URL. NEVER print - use `masked`. undefined means a direct connection. */
  url?: string;
  /** Password-masked form, safe to display. undefined when direct. */
  masked?: string;
  source: ProxySource;
  /** True when --proxy shadowed a stored pin, so callers can warn. */
  overrodePin?: boolean;
}

/** Human-readable description of the precedence rule that applied. */
export function describeProxySource(source: ProxySource): string {
  switch (source) {
    case "flag":
      return "--proxy";
    case "pin":
      return "pinned";
    case "pin-label":
      return "pinned label";
    case "file":
      return "--proxy-file";
    case "none":
      return "direct";
  }
}

/** Extracts the reusable resolution inputs from a config. */
export function baseOf(config: ClientConfig): ProxyResolutionBase {
  return {
    sessionPath: config.sessionPath,
    debug: config.debug,
    explicitProxy: config.explicitProxy,
    proxyFile: config.proxyFile,
    proxyStrategy: config.proxyStrategy,
  };
}

/**
 * Resolves a `label` pin against the --proxy-file pool.
 *
 * @throws when the label cannot be resolved. Never falls back to a direct
 *   connection: the operator asked for a specific egress IP, and silently
 *   ignoring that would leak the real one.
 */
async function resolveLabelPin(
  base: ProxyResolutionBase,
  instanceId: string,
  label: string
): Promise<string> {
  if (!base.proxyFile) {
    throw new Error(
      `Instance "${instanceId}" is pinned to proxy label "${label}", but no proxy file is configured. Pass --proxy-file or set MIAW_PROXY_FILE.`
    );
  }

  const entries = await loadProxyList(base.proxyFile, { strict: false });
  const matches = entries.filter((entry) => entry.label === label);

  if (matches.length === 0) {
    throw new Error(
      `Instance "${instanceId}" is pinned to proxy label "${label}", which matches no entry in ${base.proxyFile}.`
    );
  }

  if (matches.length === 1) {
    return matches[0].url;
  }

  // Several proxies share the label - pick one deterministically so this
  // instance keeps a stable egress IP across invocations.
  const rotator = new ProxyRotator({ proxies: matches, strategy: "deterministic" });
  try {
    return rotator.forInstance(instanceId).url;
  } finally {
    rotator.close();
  }
}

/**
 * Applies proxy precedence for one instance.
 *
 * Emits the override warnings itself so every caller reports them identically.
 *
 * @throws when a pin or proxy file is configured but unusable.
 */
export async function resolveProxyForInstance(
  base: ProxyResolutionBase,
  instanceId: string
): Promise<ResolvedProxy> {
  const pin = getPinnedProxy(base.sessionPath, instanceId);

  // 1. --proxy always wins.
  if (base.explicitProxy) {
    if (base.proxyFile) {
      console.log("⚠️  --proxy overrides --proxy-file");
    }
    if (pin) {
      // Worth shouting about: overriding a pin is how a live session's egress
      // IP gets changed by accident, which WhatsApp reads as account takeover.
      console.log(
        `⚠️  --proxy overrides the pinned proxy for "${instanceId}" (${describePin(pin)})`
      );
    }
    return {
      url: base.explicitProxy,
      masked: maskProxyUrl(base.explicitProxy),
      source: "flag",
      ...(pin ? { overrodePin: true } : {}),
    };
  }

  // 2. A pin for this specific instance.
  if (pin?.url) {
    return { url: pin.url, masked: maskProxyUrl(pin.url), source: "pin" };
  }
  if (pin?.label) {
    const url = await resolveLabelPin(base, instanceId, pin.label);
    return { url, masked: maskProxyUrl(url), source: "pin-label" };
  }

  // 3. Selection from the pool, hashed on THIS instance's id.
  if (base.proxyFile) {
    const url = await selectProxyForInstance(
      base.proxyFile,
      base.proxyStrategy ?? DEFAULT_PROXY_STRATEGY,
      instanceId
    );
    return { url, masked: maskProxyUrl(url), source: "file" };
  }

  // 4. Direct.
  return { source: "none" };
}

/**
 * Resolves a proxy and assembles the ClientConfig everything downstream passes
 * around. The resolution inputs travel with it so a later instance switch can
 * re-resolve instead of inheriting.
 */
export async function buildClientConfig(
  base: ProxyResolutionBase,
  instanceId: string
): Promise<ClientConfig> {
  const resolved = await resolveProxyForInstance(base, instanceId);

  return {
    instanceId,
    sessionPath: base.sessionPath,
    ...(base.debug !== undefined ? { debug: base.debug } : {}),
    ...(resolved.url ? { proxy: resolved.url } : {}),
    ...(base.explicitProxy ? { explicitProxy: base.explicitProxy } : {}),
    ...(base.proxyFile ? { proxyFile: base.proxyFile } : {}),
    ...(base.proxyStrategy ? { proxyStrategy: base.proxyStrategy } : {}),
  };
}

/**
 * A safe, display-only description of an instance's pin.
 *
 * Synchronous and pin-only: it never reads the proxy file, so listing many
 * instances costs no I/O per row. Returns null when nothing is pinned.
 */
export function describePinnedProxy(sessionPath: string, instanceId: string): string | null {
  return describePin(getPinnedProxy(sessionPath, instanceId));
}
