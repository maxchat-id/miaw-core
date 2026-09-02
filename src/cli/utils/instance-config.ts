/**
 * Per-Instance CLI Configuration Store
 *
 * Owns *all* access to `<sessionPath>/instances.json`, which pins a proxy to a
 * named instance so `miaw-cli --instance-id bot-3 ...` reaches the right egress
 * IP with no flags.
 *
 * Why a single central file rather than `<sessionPath>/<id>/proxy.json`:
 * `AuthHandler.clearSession()` does `rmSync` on the whole instance directory, so
 * anything stored inside it is destroyed by `logout()` - and a pin has to be
 * settable *before* `instance create`, since you want the pairing itself to come
 * from the final egress IP.
 *
 * Concurrency: writes are atomic (tmp + rename), but two CLI processes doing
 * read-modify-write can still clobber each other. That is accepted - pins are
 * rare, human-driven operations, not a hot path.
 *
 * Secrets: a `url` pin embeds proxy credentials, so the file is written 0600 and
 * lives inside an already-gitignored session directory. Prefer the `label` form,
 * which stores no credentials at all.
 */

import * as fs from "fs";
import * as path from "path";
import { maskProxyUrl, validateProxyConfig } from "../../utils/proxy-agent.js";

/** File name inside the session directory. */
const CONFIG_FILENAME = "instances.json";

/** Current on-disk schema version. */
const CONFIG_VERSION = 1 as const;

/**
 * A proxy assignment for one instance.
 *
 * Exactly one of `url` / `label` is set:
 * - `url`   - a full proxy URL, credentials included. NEVER print it raw.
 * - `label` - names a `label=` entry in the `--proxy-file` pool. Stores no
 *             credentials, so rotating a proxy password touches only that file.
 */
export interface InstanceProxyPin {
  url?: string;
  label?: string;
  updatedAt?: string;
}

export interface InstanceRecord {
  proxy?: InstanceProxyPin;
}

export interface InstanceConfigFile {
  version: typeof CONFIG_VERSION;
  instances: Record<string, InstanceRecord>;
}

/** Paths already warned about, so the REPL does not repeat itself every read. */
const permissionWarned = new Set<string>();

/** Full path to the config file for a session directory. */
export function getInstanceConfigPath(sessionPath: string): string {
  return path.join(sessionPath, CONFIG_FILENAME);
}

function emptyConfig(): InstanceConfigFile {
  return { version: CONFIG_VERSION, instances: {} };
}

/**
 * Warn once per path if the file is readable by group or other.
 * Best-effort: a stat failure is not worth failing a command over.
 */
function warnOnLoosePermissions(filePath: string): void {
  if (permissionWarned.has(filePath)) return;
  try {
    const mode = fs.statSync(filePath).mode;
    if (mode & 0o077) {
      permissionWarned.add(filePath);
      console.error(
        `⚠️  ${filePath} is readable by other users and may contain proxy credentials. Fix with: chmod 600 ${filePath}`
      );
    }
  } catch {
    // Ignore - the caller is about to surface any real read error.
  }
}

/**
 * Read the config file.
 *
 * A missing file is normal and yields an empty config. Malformed content
 * **throws**: silently falling back to empty would mean "no proxy pinned",
 * which means the command connects directly and leaks the real IP - the exact
 * failure this file exists to prevent.
 */
export function readInstanceConfig(sessionPath: string): InstanceConfigFile {
  const filePath = getInstanceConfigPath(sessionPath);

  if (!fs.existsSync(filePath)) {
    return emptyConfig();
  }

  warnOnLoosePermissions(filePath);

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    throw new Error(
      `Cannot read ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `${filePath} is not valid JSON. Fix or delete it - refusing to continue, because treating it as empty would connect without the pinned proxy.`
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${filePath} must contain a JSON object.`);
  }

  const candidate = parsed as Partial<InstanceConfigFile>;
  if (typeof candidate.instances !== "object" || candidate.instances === null) {
    throw new Error(`${filePath} is missing an "instances" object.`);
  }

  return {
    version: CONFIG_VERSION,
    instances: candidate.instances as Record<string, InstanceRecord>,
  };
}

/**
 * Write the config atomically with owner-only permissions.
 *
 * tmp + rename means a crash mid-write cannot leave a half-parsed file that
 * `readInstanceConfig` would reject on the next command.
 */
function writeInstanceConfig(sessionPath: string, config: InstanceConfigFile): void {
  const filePath = getInstanceConfigPath(sessionPath);
  const tmpPath = `${filePath}.${process.pid}.tmp`;

  fs.mkdirSync(sessionPath, { recursive: true });

  try {
    fs.writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmpPath, filePath);
    try {
      // rename preserves the tmp file's mode, but an pre-existing target may
      // have been created with looser permissions by an older version.
      fs.chmodSync(filePath, 0o600);
    } catch {
      // No-op on platforms without POSIX permissions.
    }
  } finally {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // Already renamed away, or unremovable - nothing useful to do.
    }
  }
}

/** The stored record for one instance, or undefined when nothing is stored. */
export function getInstanceRecord(
  sessionPath: string,
  instanceId: string
): InstanceRecord | undefined {
  return readInstanceConfig(sessionPath).instances[instanceId];
}

/** The proxy pinned to an instance, or undefined when none is pinned. */
export function getPinnedProxy(
  sessionPath: string,
  instanceId: string
): InstanceProxyPin | undefined {
  const pin = getInstanceRecord(sessionPath, instanceId)?.proxy;
  if (!pin) return undefined;
  if (!pin.url && !pin.label) return undefined;
  return pin;
}

/**
 * Pin a proxy to an instance.
 *
 * @throws if the pin sets both `url` and `label`, neither, or an unusable URL.
 *   Throwing beats storing a pin that would fail at connect time, when the
 *   operator is no longer watching.
 */
export function setInstanceProxyPin(
  sessionPath: string,
  instanceId: string,
  pin: InstanceProxyPin
): void {
  if (pin.url && pin.label) {
    throw new Error("A proxy pin sets either a url or a label, not both.");
  }
  if (!pin.url && !pin.label) {
    throw new Error("A proxy pin needs either a url or a label.");
  }
  if (pin.url && !validateProxyConfig(pin.url)) {
    throw new Error(
      `Invalid proxy configuration: ${maskProxyUrl(pin.url)} (supported: http, https, socks4, socks4a, socks5, socks5h)`
    );
  }

  const config = readInstanceConfig(sessionPath);
  const existing = config.instances[instanceId] ?? {};

  config.instances[instanceId] = {
    ...existing,
    proxy: {
      ...(pin.url ? { url: pin.url } : {}),
      ...(pin.label ? { label: pin.label } : {}),
      updatedAt: new Date().toISOString(),
    },
  };

  writeInstanceConfig(sessionPath, config);
}

/**
 * Remove an instance's proxy pin.
 *
 * @returns false when nothing was pinned, so the caller can say so rather than
 *   reporting a success that changed nothing.
 */
export function clearInstanceProxyPin(sessionPath: string, instanceId: string): boolean {
  const config = readInstanceConfig(sessionPath);
  const record = config.instances[instanceId];

  if (!record?.proxy) {
    return false;
  }

  delete record.proxy;

  // Drop the record entirely once it holds nothing else.
  if (Object.keys(record).length === 0) {
    delete config.instances[instanceId];
  }

  writeInstanceConfig(sessionPath, config);
  return true;
}

/** Forget an instance completely. Called when the instance itself is deleted. */
export function deleteInstanceRecord(sessionPath: string, instanceId: string): void {
  const config = readInstanceConfig(sessionPath);
  if (!(instanceId in config.instances)) {
    return;
  }
  delete config.instances[instanceId];
  writeInstanceConfig(sessionPath, config);
}

/**
 * Every instance id carrying a proxy pin.
 *
 * Includes ids with no session directory yet - pinning before `instance create`
 * is the supported workflow, and surfacing those makes it discoverable.
 */
export function listPinnedInstanceIds(sessionPath: string): string[] {
  const config = readInstanceConfig(sessionPath);
  return Object.entries(config.instances)
    .filter(([, record]) => record?.proxy?.url || record?.proxy?.label)
    .map(([instanceId]) => instanceId)
    .sort();
}

/**
 * A short, safe description of an instance's pin for display.
 * Returns null when nothing is pinned. Never returns credentials.
 */
export function describePin(pin: InstanceProxyPin | undefined): string | null {
  if (!pin) return null;
  if (pin.label) return `label:${pin.label}`;
  if (pin.url) return maskProxyUrl(pin.url);
  return null;
}
