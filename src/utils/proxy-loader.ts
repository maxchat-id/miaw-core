/**
 * Proxy List File Loader
 *
 * Loads proxy lists from TXT (one per line) or JSON (array) files, with
 * format auto-detection, per-entry validation, and an optional hot-reload
 * watcher.
 *
 * This module owns all filesystem access for proxy lists. It must not import
 * from proxy-rotator.ts - the dependency runs one way (rotator -> loader).
 *
 * Conventions: like createProxyAgents(), these functions throw rather than
 * returning { success, error } result objects - that pattern is for
 * MiawClient methods. Nothing here logs to the console; problems are
 * reported through the onInvalid/onError callbacks so the caller decides
 * how to surface them.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ProxyConfig } from "../types/index.js";
import { maskProxyUrl, validateProxyConfig } from "./proxy-agent.js";

/**
 * A proxy list entry: a ProxyConfig plus rotation metadata.
 */
export interface ProxyPoolEntry extends ProxyConfig {
  /** Relative selection weight for the "weighted" strategy. Default 1. 0 = drained. */
  weight?: number;
  /** Optional human label (region, vendor) for stats and debugging. */
  label?: string;
}

/** Supported proxy list file formats. */
export type ProxyFileFormat = "txt" | "json";

/** Protocols a scheme-less TXT line can be expanded to. */
export type ProxyDefaultProtocol =
  | "http"
  | "https"
  | "socks"
  | "socks4"
  | "socks5";

export interface ProxyParseOptions {
  /** Force a format instead of auto-detecting. */
  format?: ProxyFileFormat;
  /** Scheme applied to scheme-less TXT lines. Default "http". */
  defaultProtocol?: ProxyDefaultProtocol;
  /**
   * true (default): throw on the first invalid entry.
   * false: skip it and report through onInvalid.
   */
  strict?: boolean;
  /** Called for each skipped entry when strict is false. `masked` never contains the password. */
  onInvalid?: (info: { line: number; reason: string; masked: string }) => void;
  /** File name used in error messages. Set automatically by loadProxyList. */
  source?: string;
}

export interface ProxyListWatchOptions {
  /** fs.watchFile poll interval in ms. Default 2000. */
  interval?: number;
  /** Debounce window after a detected change, in ms. Default 250. */
  debounceMs?: number;
  /** Parse options applied on every reload. */
  parse?: ProxyParseOptions;
  /** Called when a reload fails. The watcher keeps running and the previous list is retained. */
  onError?: (error: Error) => void;
}

export interface ProxyListWatcher {
  readonly filePath: string;
  /** Stops watching. Idempotent. */
  close(): void;
}

const TXT_EXTENSIONS = new Set([".txt", ".list", ".conf", ""]);

/**
 * Builds the error prefix "proxies.txt:12: " (or "line 12: " with no source).
 */
function locate(source: string | undefined, line: number): string {
  return source ? `${source}:${line}: ` : `line ${line}: `;
}

/**
 * Reports an invalid entry: throws in strict mode, otherwise calls onInvalid.
 */
function reject(
  raw: string,
  line: number,
  reason: string,
  options: ProxyParseOptions
): void {
  const masked = maskProxyUrl(raw);
  if (options.strict !== false) {
    throw new Error(`${locate(options.source, line)}${reason} (${masked})`);
  }
  options.onInvalid?.({ line, reason, masked });
}

/**
 * Expands a scheme-less TXT line into a URL.
 *
 * Proxy vendors ship lists as `host:port` or `host:port:user:pass`. Anything
 * else is ambiguous and rejected - a password containing ":" must use the
 * full URL form.
 */
function expandSchemeless(
  line: string,
  defaultProtocol: ProxyDefaultProtocol
): string | null {
  const parts = line.split(":");

  if (parts.length === 2) {
    const [host, port] = parts;
    if (!host || !port) return null;
    return `${defaultProtocol}://${host}:${port}`;
  }

  if (parts.length === 4) {
    const [host, port, user, pass] = parts;
    if (!host || !port) return null;
    const auth = `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`;
    return `${defaultProtocol}://${auth}${host}:${port}`;
  }

  return null;
}

/**
 * Parses trailing `key=value` metadata tokens off a TXT line.
 *
 * Safe to split on whitespace: a proxy URL cannot contain unescaped spaces.
 */
function splitMetadata(line: string): {
  url: string;
  weight?: number;
  label?: string;
  badToken?: string;
} {
  const [url, ...tokens] = line.split(/\s+/);
  let weight: number | undefined;
  let label: string | undefined;

  for (const token of tokens) {
    const eq = token.indexOf("=");
    const key = eq === -1 ? token : token.slice(0, eq);
    const value = eq === -1 ? "" : token.slice(eq + 1);

    if (key === "weight") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return { url, weight, label, badToken: token };
      weight = parsed;
    } else if (key === "label") {
      if (!value) return { url, weight, label, badToken: token };
      label = value;
    } else {
      return { url, weight, label, badToken: token };
    }
  }

  return { url, weight, label };
}

/**
 * Parses TXT content: one proxy per line.
 *
 * - A line is a comment only when its first non-whitespace character is
 *   "#" or ";". Inline "#" is never stripped - it would corrupt passwords.
 *   Write a literal "#" in a password as %23.
 * - Trailing \r is stripped explicitly (vendor lists are often CRLF).
 */
function parseTxt(content: string, options: ProxyParseOptions): ProxyPoolEntry[] {
  const defaultProtocol = options.defaultProtocol ?? "http";
  const entries: ProxyPoolEntry[] = [];

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const line = lines[i].replace(/\r$/, "").trim();

    if (!line || line.startsWith("#") || line.startsWith(";")) continue;

    const { url: rawUrl, weight, label, badToken } = splitMetadata(line);
    if (badToken !== undefined) {
      reject(rawUrl, lineNumber, `malformed metadata token "${badToken}"`, options);
      continue;
    }

    const url = rawUrl.includes("://")
      ? rawUrl
      : expandSchemeless(rawUrl, defaultProtocol);

    if (!url) {
      reject(rawUrl, lineNumber, "unrecognized proxy format", options);
      continue;
    }

    if (!validateProxyConfig(url)) {
      reject(url, lineNumber, describeInvalid(url), options);
      continue;
    }

    entries.push({
      url,
      ...(weight !== undefined && { weight }),
      ...(label !== undefined && { label }),
    });
  }

  return entries;
}

/**
 * Explains why a URL failed validation, without leaking credentials.
 */
function describeInvalid(url: string): string {
  try {
    return `unsupported proxy protocol "${new URL(url).protocol}"`;
  } catch {
    return "malformed proxy URL";
  }
}

/**
 * Parses JSON content: an array of strings and/or objects, or a
 * { "proxies": [...] } wrapper.
 *
 * There is deliberately no "strategy" key - rotation strategy is a
 * code/CLI concern, and honoring it here would create a "which wins"
 * ambiguity and couple this module to the rotator's types.
 */
function parseJson(content: string, options: ProxyParseOptions): ProxyPoolEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `${options.source ? `${options.source}: ` : ""}invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (data && typeof data === "object" && !Array.isArray(data)) {
    const wrapper = (data as { proxies?: unknown }).proxies;
    if (!Array.isArray(wrapper)) {
      throw new Error(
        `${options.source ? `${options.source}: ` : ""}expected an array of proxies or a { "proxies": [...] } object`
      );
    }
    data = wrapper;
  }

  if (!Array.isArray(data)) {
    throw new Error(
      `${options.source ? `${options.source}: ` : ""}expected an array of proxies or a { "proxies": [...] } object`
    );
  }

  const entries: ProxyPoolEntry[] = [];

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const position = i + 1;

    if (typeof item === "string") {
      if (!validateProxyConfig(item)) {
        reject(item, position, describeInvalid(item), options);
        continue;
      }
      entries.push({ url: item });
      continue;
    }

    if (!item || typeof item !== "object") {
      // Never stringify the item - it may carry a password.
      reject("", position, "entry must be a string or an object", options);
      continue;
    }

    const record = item as Record<string, unknown>;
    if (typeof record.url !== "string") {
      reject("", position, 'entry is missing a string "url" field', options);
      continue;
    }

    const entry: ProxyPoolEntry = { url: record.url };
    if (typeof record.username === "string") entry.username = record.username;
    if (typeof record.password === "string") entry.password = record.password;
    if (record.weight !== undefined) {
      if (typeof record.weight !== "number" || !Number.isFinite(record.weight)) {
        reject(entry.url, position, "weight must be a finite number", options);
        continue;
      }
      entry.weight = record.weight;
    }
    if (typeof record.label === "string") entry.label = record.label;

    if (!validateProxyConfig(entry)) {
      reject(entry.url, position, describeInvalid(entry.url), options);
      continue;
    }

    entries.push(entry);
  }

  return entries;
}

/**
 * Resolves which format to parse content as.
 *
 * Order: explicit option -> file extension -> content sniff.
 */
function detectFormat(
  content: string,
  filePath: string | undefined,
  options: ProxyParseOptions
): ProxyFileFormat {
  if (options.format) return options.format;

  if (filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".json") return "json";
    if (TXT_EXTENSIONS.has(ext)) {
      // A .txt file holding JSON is common enough to be worth sniffing.
      const head = content.trimStart()[0];
      return head === "[" || head === "{" ? "json" : "txt";
    }
  }

  const head = content.trimStart()[0];
  return head === "[" || head === "{" ? "json" : "txt";
}

/**
 * Parses proxy list content that is already in memory.
 *
 * Split out from loadProxyList so most tests need no temp files.
 *
 * @throws if the content is malformed, or (in strict mode) on the first invalid entry
 */
export function parseProxyList(
  content: string,
  options: ProxyParseOptions = {}
): ProxyPoolEntry[] {
  const format = detectFormat(content, options.source, options);
  return format === "json"
    ? parseJson(content, options)
    : parseTxt(content, options);
}

/**
 * Reads and parses a proxy list file.
 *
 * @throws if the file is missing/unreadable, the format is unparseable, or
 *   (in strict mode) any entry is invalid
 */
export async function loadProxyList(
  filePath: string,
  options: ProxyParseOptions = {}
): Promise<ProxyPoolEntry[]> {
  const absolute = path.resolve(filePath);
  let content: string;

  try {
    content = await fs.promises.readFile(absolute, "utf-8");
  } catch {
    throw new Error(`Proxy list file not found or unreadable: ${filePath}`);
  }

  const resolved: ProxyParseOptions = { ...options, source: options.source ?? filePath };
  const format = options.format ?? detectFormat(content, filePath, options);
  return parseProxyList(content, { ...resolved, format });
}

/**
 * Synchronous variant of loadProxyList, for startup paths that cannot await.
 */
export function loadProxyListSync(
  filePath: string,
  options: ProxyParseOptions = {}
): ProxyPoolEntry[] {
  const absolute = path.resolve(filePath);
  let content: string;

  try {
    content = fs.readFileSync(absolute, "utf-8");
  } catch {
    throw new Error(`Proxy list file not found or unreadable: ${filePath}`);
  }

  const resolved: ProxyParseOptions = { ...options, source: options.source ?? filePath };
  const format = options.format ?? detectFormat(content, filePath, options);
  return parseProxyList(content, { ...resolved, format });
}

/**
 * Partitions a list of proxies into valid and invalid entries.
 *
 * Returns data rather than throwing, mirroring validateProxyConfig's boolean.
 * Invalid URLs are masked - callers print this.
 */
export function validateProxyList(
  entries: readonly (ProxyPoolEntry | string)[]
): {
  valid: ProxyPoolEntry[];
  invalid: Array<{ masked: string; reason: string }>;
} {
  const valid: ProxyPoolEntry[] = [];
  const invalid: Array<{ masked: string; reason: string }> = [];

  for (const entry of entries) {
    const normalized: ProxyPoolEntry =
      typeof entry === "string" ? { url: entry } : entry;

    if (validateProxyConfig(normalized)) {
      valid.push(normalized);
    } else {
      invalid.push({
        masked: maskProxyUrl(normalized),
        reason: describeInvalid(normalized.url),
      });
    }
  }

  return { valid, invalid };
}

/**
 * Watches a proxy list file and reports the reparsed list on change.
 *
 * Uses fs.watchFile (stat polling) rather than fs.watch on purpose.
 * fs.watch follows the inode, so the dominant update pattern for a proxy
 * list - an atomic replace via `mv`, an editor write-and-rename, or a
 * Kubernetes ConfigMap symlink swap - leaves an fs.watch watcher
 * permanently and silently dead. Polling survives all of them.
 *
 * The watcher is non-persistent: it will not hold the event loop open, so
 * a CLI process still exits normally.
 *
 * A reload that yields zero valid entries is treated as a failure and the
 * previous list is retained - this closes the truncate-then-write race that
 * debouncing alone cannot.
 */
export function watchProxyList(
  filePath: string,
  onChange: (entries: ProxyPoolEntry[]) => void,
  options: ProxyListWatchOptions = {}
): ProxyListWatcher {
  const absolute = path.resolve(filePath);
  const interval = options.interval ?? 2000;
  const debounceMs = options.debounceMs ?? 250;

  let debounceTimer: NodeJS.Timeout | undefined;
  let closed = false;

  const reload = (): void => {
    if (closed) return;
    try {
      const entries = loadProxyListSync(absolute, {
        ...options.parse,
        source: options.parse?.source ?? filePath,
      });
      if (entries.length === 0) {
        options.onError?.(
          new Error(
            `Proxy list reload produced no valid entries; keeping the previous list: ${filePath}`
          )
        );
        return;
      }
      onChange(entries);
    } catch (error) {
      options.onError?.(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  };

  const listener = (curr: fs.Stats, prev: fs.Stats): void => {
    if (closed) return;

    // mtimeMs 0 means the file no longer exists. Keep watching - proxy
    // lists are frequently replaced rather than edited in place.
    if (curr.mtimeMs === 0) {
      options.onError?.(
        new Error(`Proxy list file disappeared: ${filePath}`)
      );
      return;
    }

    if (curr.mtimeMs === prev.mtimeMs) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(reload, debounceMs);
    // Don't hold the event loop open for a pending debounce either.
    debounceTimer.unref?.();
  };

  fs.watchFile(absolute, { persistent: false, interval }, listener);

  return {
    filePath: absolute,
    close(): void {
      if (closed) return;
      closed = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
      // Pass the listener: omitting it removes every watcher registered on
      // this path, including other consumers'.
      fs.unwatchFile(absolute, listener);
    },
  };
}
