/**
 * Instance Management Commands
 *
 * Commands for managing WhatsApp instances (list, status, create, delete, etc.)
 */

import * as path from "path";
import {
  deleteInstance,
  ensureConnected,
  listInstances,
  type ClientConfig,
} from "../utils/session.js";
import {
  disconnectClient,
  getOrCreateClient,
  peekClient,
} from "../utils/client-cache.js";
import { listInstanceStates, updateInstanceState } from "../utils/instance-registry.js";
import { confirm } from "../utils/prompt.js";
import { maskProxyUrl } from "../../utils/proxy-agent.js";
import {
  clearInstanceProxyPin,
  deleteInstanceRecord,
  describePin,
  getPinnedProxy,
  listPinnedInstanceIds,
  setInstanceProxyPin,
  type InstanceProxyPin,
} from "../utils/instance-config.js";
import { DEFAULT_PROXY_STRATEGY, selectProxyForInstance } from "../utils/proxy-config.js";
import type { ProxyRotationStrategy } from "../../utils/proxy-rotator.js";
import { getErrorMessage } from "../../utils/type-guards.js";
import {
  describePinnedProxy,
  describeProxySource,
  type ProxySource,
} from "../utils/proxy-resolver.js";
import { formatTable } from "../utils/formatter.js";
import type { CLIContext } from "../context.js";

/**
 * Every handler here takes the whole ClientConfig rather than a bare
 * (sessionPath, instanceId) pair. The pair silently dropped `proxy` and
 * `debug`, so an instance connected through no proxy at all while the config
 * said otherwise. Passing the config makes that impossible to reintroduce.
 */

/** Describes the egress a config will use, for status and confirmation lines. */
function describeConfigProxy(config: ClientConfig): string {
  return config.proxy ? maskProxyUrl(config.proxy) : "a direct connection";
}

/**
 * Result type for instance connect command
 */
export interface InstanceConnectResult {
  success: boolean;
  switchToInstance?: string;
}

/**
 * Result type for instance disconnect command
 */
export interface InstanceDisconnectResult {
  success: boolean;
  switchToInstance?: string;
}

/**
 * List all instances
 */
export async function cmdInstanceList(
  sessionPath: string,
  jsonOutput = false
): Promise<boolean> {
  const instances = listInstances(sessionPath);

  // Instances pinned to a proxy but not created yet are worth listing:
  // pinning before `instance create` is the supported workflow (you want the
  // pairing itself to come from the final egress IP), and a pin left behind by
  // `instance logout` should stay visible.
  const pinnedOnly = listPinnedInstanceIds(sessionPath).filter(
    (id) => !instances.includes(id)
  );

  if (instances.length === 0 && pinnedOnly.length === 0) {
    if (jsonOutput) {
      console.log(JSON.stringify({ count: 0, instances: [] }, null, 2));
      return true;
    }
    console.log("No instances found.");
    console.log(`Create one with: miaw-cli instance create <id>`);
    return true;
  }

  // Get states from registry for all tracked instances
  const trackedStates = new Map<string, string>();
  for (const info of listInstanceStates(sessionPath)) {
    trackedStates.set(info.instanceId, info.state);
  }

  const rows = [
    ...instances.map((instanceId) => ({
      instanceId,
      status: trackedStates.get(instanceId) ?? "disconnected",
      proxy: describePinnedProxy(sessionPath, instanceId) ?? "-",
    })),
    ...pinnedOnly.map((instanceId) => ({
      instanceId,
      status: "[not created]",
      proxy: describePinnedProxy(sessionPath, instanceId) ?? "-",
    })),
  ];

  if (jsonOutput) {
    console.log(
      JSON.stringify(
        {
          count: rows.length,
          instances: rows.map((row) => ({
            instanceId: row.instanceId,
            status: row.status,
            created: instances.includes(row.instanceId),
            // Masked - a pinned url carries credentials.
            proxy: row.proxy === "-" ? null : row.proxy,
          })),
        },
        null,
        2
      )
    );
    return true;
  }

  console.log(`\n📱 Instances (${rows.length}):\n`);
  console.log(
    formatTable(rows, [
      { key: "instanceId", label: "Instance", width: 24 },
      { key: "status", label: "Status", width: 16 },
      { key: "proxy", label: "Proxy", width: 40 },
    ])
  );
  console.log();

  return true;
}

/**
 * Show instance status
 */
export async function cmdInstanceStatus(
  config: ClientConfig,
  instanceId: string,
  context: CLIContext,
  /** Which precedence rule produced `config.proxy`. Reported verbatim. */
  proxySource?: ProxySource
): Promise<boolean> {
  const { sessionPath } = config;
  const instances = listInstances(sessionPath);

  // An instance defined only by a proxy pin is a real one: `instance ls` lists
  // it as "[not created]", and pinning before `instance create` is the
  // supported workflow (you want the pairing itself to come from the final
  // egress IP). Resolving from session directories alone made `status` reject
  // an instance that `ls` displays - so you could pin a proxy and then not be
  // able to ask what you had just pinned.
  const pinnedOnly = listPinnedInstanceIds(sessionPath).filter(
    (id) => !instances.includes(id)
  );
  const known = [...instances, ...pinnedOnly];

  if (instanceId && !known.includes(instanceId)) {
    console.log(`❌ Instance "${instanceId}" not found.`);
    console.log(`\nAvailable instances:`, known.join(", ") || "none");
    return false;
  }

  // Show status for specific instance or all
  const targetInstances = instanceId
    ? [instanceId]
    : known.length > 0
    ? known
    : ["default"];

  for (const id of targetInstances) {
    console.log(`\n📱 Instance: ${id}`);
    console.log("─".repeat(50));

    // Try to get state from registry first (doesn't create new client)
    let state = context.registry.getInstanceState({ instanceId: id, sessionPath });
    let client: any = null;

    // If not in registry, look in the cache - peek, never create. Using
    // getOrCreateClient here would trip the proxy-mismatch check (and could
    // rebuild a client) merely because someone asked for status.
    if (state === null) {
      client = context.cache.peekClient({ instanceId: id, sessionPath });
      state = client ? client.getConnectionState() : "disconnected";
    } else {
      // Get client from registry if we have a state
      client = context.registry.getInstanceClient({ instanceId: id, sessionPath });
    }

    // Match the label `ls` uses, so the two commands cannot disagree about an
    // instance that is pinned but not yet paired. A client mid-pairing has no
    // creds.json yet, so defer to a live state when there is one.
    console.log(
      `Status: ${!instances.includes(id) && state === "disconnected" ? "[not created]" : state}`
    );
    console.log(`Session: ${path.join(sessionPath, id)}`);

    // Report the rule that actually won, not merely whether a pin exists - a
    // `--proxy` override used to be labelled "pinned", which is exactly
    // backwards for the one case an operator most needs to notice.
    if (id === config.instanceId) {
      const source = proxySource
        ? describeProxySource(proxySource)
        : config.proxy
          ? "configured"
          : "direct";
      console.log(`Proxy: ${describeConfigProxy(config)} (${source})`);
    } else {
      const pin = describePinnedProxy(sessionPath, id);
      console.log(`Proxy: ${pin ?? "not pinned"}${pin ? " (pinned)" : ""}`);
    }

    if (state === "connected" && client) {
      try {
        const profile = await client.getOwnProfile();
        if (profile) {
          console.log(`Phone: ${profile.phone || "(not available)"}`);
          console.log(`Name: ${profile.name || "(not set)"}`);
          console.log(`Business: ${profile.isBusiness ? "Yes" : "No"}`);
        }
      } catch (err: any) {
        console.log(`Profile: Error - ${err.message}`);
      }
    }
  }

  console.log();
  return true;
}

/**
 * Create new instance (triggers QR)
 */
export async function cmdInstanceCreate(config: ClientConfig): Promise<boolean> {
  const { sessionPath, instanceId } = config;
  const instances = listInstances(sessionPath);

  if (instances.includes(instanceId)) {
    console.log(`⚠️  Instance "${instanceId}" already exists.`);
    const ans = await confirm("Do you want to clear and recreate it?");
    if (!ans) {
      console.log("Cancelled.");
      return false;
    }
    // Drop any cached client before the session files vanish underneath it.
    await disconnectClient(config);
    deleteInstance(sessionPath, instanceId);
  }

  console.log(`\n📱 Creating instance: ${instanceId}`);
  console.log("─".repeat(50));
  console.log(`🌐 Pairing through ${describeConfigProxy(config)}`);

  // Cached, not bare createClient(): a bare client is never registered, so the
  // next command builds a *second* MiawClient for the same account.
  const client = getOrCreateClient(config);

  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Failed to connect: ${result.reason}`);
    return false;
  }

  console.log(`\n✅ Instance "${instanceId}" created successfully!`);
  console.log(`You can now use it with: miaw-cli --instance-id ${instanceId} <command>`);

  return true;
}

/**
 * Delete instance
 */
export async function cmdInstanceDelete(config: ClientConfig): Promise<boolean> {
  const { sessionPath, instanceId } = config;
  const instances = listInstances(sessionPath);

  if (!instances.includes(instanceId)) {
    console.log(`❌ Instance "${instanceId}" not found.`);
    return false;
  }

  const ans = await confirm(
    `Are you sure you want to delete instance "${instanceId}"?`
  );
  if (!ans) {
    console.log("Cancelled.");
    return false;
  }

  // Remove from cache first (disconnects if connected)
  await disconnectClient(config);

  // Delete session files
  const success = deleteInstance(sessionPath, instanceId);
  if (success) {
    // Deleting the instance destroys its identity, proxy pin included.
    deleteInstanceRecord(sessionPath, instanceId);
    console.log(`✅ Instance "${instanceId}" deleted.`);
    return true;
  }

  console.log(`❌ Failed to delete instance "${instanceId}".`);
  return false;
}

/**
 * Connect instance
 */
export async function cmdInstanceConnect(
  config: ClientConfig
): Promise<InstanceConnectResult> {
  const { sessionPath, instanceId } = config;
  const instances = listInstances(sessionPath);

  if (!instances.includes(instanceId)) {
    console.log(`❌ Instance "${instanceId}" not found.`);
    console.log(`Create it first with: miaw-cli instance create ${instanceId}`);
    return { success: false };
  }

  console.log(`\n📱 Connecting instance: ${instanceId}`);
  console.log(`🌐 Via ${describeConfigProxy(config)}`);

  // Pass the whole config: the old {instanceId, sessionPath} shorthand dropped
  // `proxy` and `debug`, so this cached a proxy-less client that every later
  // command then reused - traffic went direct with no indication.
  const client = getOrCreateClient(config);

  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Failed to connect: ${result.reason}`);
    return { success: false };
  }

  console.log(`✅ Connected!`);

  // Explicitly update registry state for immediate consistency
  // The event listener might not have fired yet, so update proactively
  updateInstanceState(config, "connected");

  // Signal REPL to switch to this instance
  return { success: true, switchToInstance: instanceId };
}

/**
 * Disconnect instance
 */
export async function cmdInstanceDisconnect(
  config: ClientConfig,
  currentInstanceId?: string
): Promise<InstanceDisconnectResult> {
  const { instanceId } = config;
  const client = getOrCreateClient(config);

  const state = client.getConnectionState();
  if (state !== "connected") {
    console.log(`ℹ️  Instance "${instanceId}" is not connected.`);
    // Still remove from cache to clean up
    await disconnectClient(config);
    return { success: true };
  }

  await client.disconnect();
  // Remove from cache after disconnecting
  await disconnectClient(config);
  console.log(`✅ Disconnected from "${instanceId}"`);

  // If we disconnected the currently active instance, suggest switching to default
  if (currentInstanceId && instanceId === currentInstanceId) {
    return { success: true, switchToInstance: "default" };
  }

  return { success: true };
}

/**
 * Logout and clear session
 */
export async function cmdInstanceLogout(
  config: ClientConfig,
  currentInstanceId?: string
): Promise<boolean | { success: boolean; switchToInstance?: string }> {
  const { sessionPath, instanceId } = config;
  const client = getOrCreateClient(config);

  // Always ask for confirmation
  const ans = await confirm(
    `This will logout and clear the session for "${instanceId}". Continue?`
  );
  if (!ans) {
    console.log("Cancelled.");
    return false;
  }

  // Show loading indicator
  console.log(`⏳ Logging out "${instanceId}"...`);

  // Always attempt logout to send remove-companion-device request
  // (will attempt reconnect if disconnected)
  // Note: client.logout() already clears the session directory via authHandler.clearSession()
  try {
    await client.logout();

    // Wait a brief moment for socket event handlers to complete
    // This prevents output appearing after REPL prompt is shown
    await new Promise(resolve => setTimeout(resolve, 100));
  } catch (error) {
    console.log(`⚠️  Logout request failed: ${error}`);
    console.log("   Continuing with session cleanup...");
  }

  // Remove from cache
  await disconnectClient(config);

  // Double-check session directory is deleted (logout should have already done this)
  const sessionStillExists = deleteInstance(sessionPath, instanceId);

  if (sessionStillExists) {
    // This means logout didn't clean up properly - now we cleaned it manually
    console.log(`✅ Logged out and cleared remaining session files for "${instanceId}"`);
  } else {
    // Normal case - logout already cleaned everything
    console.log(`✅ Logged out and cleared session for "${instanceId}"`);
  }

  // The proxy pin deliberately survives a logout: the session is gone but the
  // instance's identity is not, and you want to re-pair from the same egress
  // IP. `instance delete` is the operation that forgets it.
  const keptPin = getPinnedProxy(sessionPath, instanceId);
  if (keptPin) {
    console.log(
      `ℹ️  Proxy pin for "${instanceId}" kept (${describePin(keptPin)}). Remove it with: instance unset-proxy ${instanceId}`
    );
  }

  // Final brief pause to ensure message is displayed before prompt returns
  await new Promise(resolve => setTimeout(resolve, 50));

  // Check if we need to switch instances (when logging out the current instance)
  if (currentInstanceId && instanceId === currentInstanceId) {
    // Get remaining instances
    const instances = listInstances(sessionPath);

    if (instances.length > 0) {
      // Try to switch to "default" if it exists, otherwise use the first available
      const newInstance = instances.includes("default") ? "default" : instances[0];
      console.log(`📌 Switching to instance: ${newInstance}`);
      return { success: true, switchToInstance: newInstance };
    } else {
      // No instances left - stay on current (non-existent) instance
      console.log(`⚠️  No instances available. Use "instance create <id>" to create one.`);
      return true;
    }
  }

  return true;
}

/**
 * How a set-proxy invocation named the proxy. Exactly one field is set.
 *
 * `url` is the blunt form and puts credentials in shell history; `label` and
 * `fromEnv` exist so they don't have to.
 */
export interface SetProxySpec {
  /** A full proxy URL, typed directly. */
  url?: string;
  /** A `label=` from the --proxy-file pool. Stores no credentials. */
  label?: string;
  /** Materialize the current --proxy-file selection for this instance. */
  fromFile?: boolean;
  /** Read the URL from the named environment variable. */
  fromEnv?: string;
}

/**
 * Pin a proxy to an instance.
 *
 * Offline: writes a file and constructs no client. The pin applies on the
 * instance's NEXT connect - a live session must never change egress IP,
 * because WhatsApp reads that as account takeover.
 */
export async function cmdInstanceSetProxy(
  sessionPath: string,
  instanceId: string,
  spec: SetProxySpec,
  options: { proxyFile?: string; proxyStrategy?: ProxyRotationStrategy } = {},
  jsonOutput = false
): Promise<boolean> {
  const given = [
    spec.url ? "a url" : null,
    spec.label ? "--label" : null,
    spec.fromFile ? "--from-file" : null,
    spec.fromEnv ? "--from-env" : null,
  ].filter(Boolean);

  if (given.length === 0) {
    console.log("❌ Usage: instance set-proxy <id> <url|--label L|--from-file|--from-env VAR>");
    return false;
  }
  if (given.length > 1) {
    console.log(`❌ Give exactly one proxy source, not ${given.join(" and ")}.`);
    return false;
  }

  let pin: InstanceProxyPin;

  if (spec.label) {
    pin = { label: spec.label };
  } else if (spec.fromEnv) {
    const value = process.env[spec.fromEnv];
    if (!value) {
      console.log(`❌ Environment variable ${spec.fromEnv} is not set or empty.`);
      return false;
    }
    pin = { url: value };
  } else if (spec.fromFile) {
    if (!options.proxyFile) {
      console.log("❌ --from-file needs a proxy list: pass --proxy-file or set MIAW_PROXY_FILE.");
      return false;
    }
    try {
      pin = {
        url: await selectProxyForInstance(
          options.proxyFile,
          options.proxyStrategy ?? DEFAULT_PROXY_STRATEGY,
          instanceId
        ),
      };
    } catch (error) {
      console.log(`❌ Could not select a proxy from ${options.proxyFile}: ${getErrorMessage(error)}`);
      return false;
    }
  } else {
    pin = { url: spec.url };
  }

  try {
    setInstanceProxyPin(sessionPath, instanceId, pin);
  } catch (error) {
    // The message is already masked by instance-config.
    console.log(`❌ ${getErrorMessage(error)}`);
    return false;
  }

  if (jsonOutput) {
    console.log(
      JSON.stringify(
        { instanceId, pinned: describePin(pin), appliesOn: "next-connect" },
        null,
        2
      )
    );
    return true;
  }

  console.log(
    `✅ Pinned ${describePin(pin)} to "${instanceId}". Takes effect on the NEXT connect - a live session must not change egress IP.`
  );

  if (spec.url && hasCredentials(spec.url)) {
    console.log(
      "💡 Tip: use --from-env VAR or --label to keep credentials out of shell history."
    );
  }

  // If it is running right now on something else, say so plainly.
  const live = peekClient({ instanceId, sessionPath });
  if (live && live.getConnectionState() !== "disconnected") {
    const current = live.getProxyInfo();
    console.log(
      `⚠️  "${instanceId}" is currently connected through ${current ? current.url : "a direct connection"}; disconnect and reconnect to apply.`
    );
  }

  return true;
}

/** Does this URL carry a password we should warn about leaking? */
function hasCredentials(url: string): boolean {
  try {
    return new URL(url).password !== "";
  } catch {
    return false;
  }
}

/**
 * Remove an instance's proxy pin.
 *
 * @returns false when nothing was pinned, so the caller does not report a
 *   success that changed nothing.
 */
export async function cmdInstanceUnsetProxy(
  sessionPath: string,
  instanceId: string,
  jsonOutput = false
): Promise<boolean> {
  const removed = clearInstanceProxyPin(sessionPath, instanceId);

  if (jsonOutput) {
    console.log(JSON.stringify({ instanceId, removed }, null, 2));
    return removed;
  }

  if (!removed) {
    console.log(`ℹ️  No proxy pinned for "${instanceId}".`);
    return false;
  }

  console.log(
    `✅ Removed the proxy pin for "${instanceId}". Takes effect on the NEXT connect.`
  );
  return true;
}
