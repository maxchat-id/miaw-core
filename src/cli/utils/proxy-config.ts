/**
 * CLI Proxy Configuration Helpers
 *
 * Resolves --proxy-file / --proxy-strategy from the two different places
 * the CLI delivers flags from, and picks a proxy for the process's client.
 */

import { ProxyRotator, type ProxyRotationStrategy } from "../../utils/proxy-rotator.js";

/** Strategy names accepted on the command line, including the `instance` alias. */
const STRATEGY_ALIASES: Record<string, ProxyRotationStrategy> = {
  "round-robin": "round-robin",
  roundrobin: "round-robin",
  rr: "round-robin",
  random: "random",
  weighted: "weighted",
  deterministic: "deterministic",
  instance: "deterministic",
};

export const DEFAULT_PROXY_STRATEGY: ProxyRotationStrategy = "deterministic";

export const STRATEGY_NAMES = "round-robin, random, weighted, deterministic (alias: instance)";

/**
 * Normalizes a --proxy-strategy value.
 *
 * @throws if the name is not recognized - a typo silently falling back to a
 *   default could rotate a live session's IP, so fail loudly.
 */
export function parseProxyStrategy(value: string | undefined): ProxyRotationStrategy {
  if (!value) return DEFAULT_PROXY_STRATEGY;

  const strategy = STRATEGY_ALIASES[value.toLowerCase()];
  if (!strategy) {
    throw new Error(
      `Unknown proxy strategy "${value}". Valid strategies: ${STRATEGY_NAMES}`
    );
  }
  return strategy;
}

/**
 * Finds the proxy file path across both flag delivery paths.
 *
 * One-shot mode strips every --flag in bin/miaw-cli.ts before calling
 * runCommand, so the value only reaches commands via context.flags. The
 * REPL passes the raw tokenized line as args and never populates
 * context.flags, so there the value only appears in parsedArgs. Both must
 * be checked.
 */
export function resolveProxyFile(
  parsedArgs: { [key: string]: unknown },
  contextFlags?: { [key: string]: string | boolean },
  contextProxyFile?: string
): string | undefined {
  const fromArgs = parsedArgs["proxy-file"];
  if (typeof fromArgs === "string") return fromArgs;

  const fromFlags = contextFlags?.["proxy-file"];
  if (typeof fromFlags === "string") return fromFlags;

  if (contextProxyFile) return contextProxyFile;

  return process.env.MIAW_PROXY_FILE || undefined;
}

/**
 * Picks one proxy from a list file for this process's client connection.
 *
 * The rotator is built lazily here rather than at startup so that commands
 * which never touch a proxy don't pay for a file read (or inherit its
 * failure). It is discarded immediately after selection - no watcher, no
 * long-lived state.
 *
 * @throws if the file cannot be loaded or contains no usable proxies
 */
export async function selectProxyForInstance(
  filePath: string,
  strategy: ProxyRotationStrategy,
  instanceId: string
): Promise<string> {
  const rotator = await ProxyRotator.fromFile(filePath, { strategy });
  try {
    const entry =
      strategy === "deterministic"
        ? rotator.forInstance(instanceId)
        : rotator.next(instanceId);
    return entry.url;
  } finally {
    rotator.close();
  }
}
