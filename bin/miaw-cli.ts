#!/usr/bin/env node
/**
 * miaw-cli - WhatsApp Command-Line Interface
 *
 * Usage:
 *   miaw-cli                    # Start interactive REPL
 *   miaw-cli <command> [args]   # Run one-shot command
 *
 * Examples:
 *   miaw-cli get groups
 *   miaw-cli send text 6281234567890 "Hello"
 *   miaw-cli instance status
 */

import * as dotenv from "dotenv";
import { runRepl } from "../src/cli/repl.js";
import { runCommand } from "../src/cli/commands/index.js";
import { initializeCLICleanup } from "../src/cli/utils/cleanup.js";
import { getErrorMessage } from "../src/utils/type-guards.js";
import {
  configFromResolved,
  describeProxySource,
  resolveProxyForInstance,
  type ProxyResolutionBase,
} from "../src/cli/utils/proxy-resolver.js";
import { maskProxyUrl } from "../src/utils/proxy-agent.js";
import {
  parseProxyStrategy,
} from "../src/cli/utils/proxy-config.js";

// Initialize CLI cleanup handlers for graceful shutdown
initializeCLICleanup();

// Load environment variables
dotenv.config();
dotenv.config({ path: ".env.test" });

// Default configuration
const DEFAULT_INSTANCE_ID = process.env.MIAW_INSTANCE_ID || "default";
const DEFAULT_SESSION_PATH = process.env.MIAW_SESSION_PATH || "./sessions-cli";
// Proxy credentials belong in .env, not in shell history.
const DEFAULT_PROXY = process.env.MIAW_PROXY || undefined;
const DEFAULT_PROXY_FILE = process.env.MIAW_PROXY_FILE || undefined;
const DEFAULT_PROXY_STRATEGY_ENV = process.env.MIAW_PROXY_STRATEGY || undefined;

/**
 * Global flags that never take a value. Listed explicitly because the parser is
 * positional: without this an `--ip`-style flag consumes the command name.
 */
const BOOLEAN_FLAGS = new Set(["json", "debug", "help", "version", "ip", "from-file"]);

/**
 * Parse CLI arguments
 */
function parseArgs(args: string[]): {
  command: string;
  args: string[];
  flags: { [key: string]: string | boolean };
} {
  const flags: { [key: string]: string | boolean } = {};
  const commandArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const flagName = arg.slice(2);
      // Value-less flags must never swallow the next token. `--json instance ls`
      // otherwise parsed as json="instance", leaving the command empty and
      // reporting "Unknown command: ls" - even though --json is documented as a
      // global option, i.e. valid before the command.
      if (BOOLEAN_FLAGS.has(flagName)) {
        flags[flagName] = true;
        continue;
      }
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("--")) {
        flags[flagName] = nextArg;
        i++;
      } else {
        flags[flagName] = true;
      }
    } else {
      commandArgs.push(arg);
    }
  }

  const command = commandArgs[0] || "";
  const remainingArgs = commandArgs.slice(1);

  return { command, args: remainingArgs, flags };
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
╔════════════════════════════════════════════════════════════════════════╗
║                     miaw-cli - WhatsApp CLI Tool                       ║
╚════════════════════════════════════════════════════════════════════════╝

USAGE:
  miaw-cli                                    Start interactive REPL mode
  miaw-cli <command> [args]                   Run one-shot command

GLOBAL FLAGS:
  --instance-id <id>                          Instance ID (default: "default")
  --session-path <path>                       Session directory
  --proxy <url>                               Proxy URL (http/https/socks4/socks4a/socks5/socks5h)
  --proxy-file <path>                         Proxy list file (.txt one-per-line, or .json array)
  --proxy-strategy <strategy>                 Pick from --proxy-file: round-robin | random |
                                              weighted | deterministic (default: deterministic)
  --json                                      Output as JSON
  --debug                                     Enable verbose logging

COMMANDS:
  instance    Manage instances (ls, status, create, delete, connect, disconnect,
              logout, set-proxy, unset-proxy)
  get         Fetch data (profile, contacts, groups, chats, messages, labels)
  load        Load older messages from history
  send        Send messages (text, image, document)
  group       Group management (list, info, participants, invite, settings)
  check       Check if phone numbers are on WhatsApp
  contact     Contact management (list, info, business, picture, add, remove)
  profile     Profile management (picture, name, status)
  label       Label management - WhatsApp Business (list, chats, add, chat)
  catalog     Catalog management - WhatsApp Business (list, collections, product)
  proxy       Inspect and test proxies (list, test, test-all) - no connection needed

COMMON OPTIONS:
  --limit N                                   Limit number of results
  --filter TEXT                               Filter by name/phone (case-insensitive)

EXAMPLES:
  miaw-cli get contacts --limit 10 --filter john
  miaw-cli send text 6281234567890 "Hello"
  miaw-cli group participants add 120363xxx@g.us 628xxx
  miaw-cli contact add 6281234567890 "John Doe"
  miaw-cli proxy test socks5://proxy.example.com:1080
  miaw-cli --instance-id bot-3 --proxy-file ./proxies.txt get groups
  miaw-cli instance set-proxy bot-3 --label eu     Pin a proxy, no credentials stored
  miaw-cli --instance-id bot-3 get groups          Uses bot-3's pinned proxy, no flags

PROXY PRECEDENCE (highest first):
  --proxy / MIAW_PROXY  >  pinned in <session-path>/instances.json
                        >  --proxy-file  >  direct
  A pin applies on the instance's NEXT connect. Never change a live session's
  egress IP - WhatsApp reads that as account takeover.

REPL MODE:
  Run 'miaw-cli' without arguments to start interactive mode.
  In REPL, use 'help <command>' for detailed help on each command.

For detailed documentation: https://github.com/biji-dev/miaw-core/blob/main/docs/CLI.md
`);
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  // Show help if requested
  if (args.includes("--help") || args.includes("-h")) {
    showHelp();
    process.exit(0);
  }

  const { command, args: commandArgs, flags } = parseArgs(args);

  // Extract global flags
  const instanceId = (flags["instance-id"] as string) || DEFAULT_INSTANCE_ID;
  const sessionPath = (flags["session-path"] as string) || DEFAULT_SESSION_PATH;
  const jsonOutput = flags.json === true;
  const debugMode = flags.debug === true;

  // Extract proxy flags (CLI flag wins over the MIAW_PROXY* env fallbacks)
  const explicitProxy = (flags.proxy as string | undefined) || DEFAULT_PROXY;
  const proxyFile = (flags["proxy-file"] as string | undefined) || DEFAULT_PROXY_FILE;

  let proxyStrategy;
  try {
    proxyStrategy = parseProxyStrategy(
      (flags["proxy-strategy"] as string | undefined) || DEFAULT_PROXY_STRATEGY_ENV
    );
  } catch (error: unknown) {
    console.error(`❌ ${getErrorMessage(error)}`);
    process.exit(1);
  }

  // Precedence lives in one place - see src/cli/utils/proxy-resolver.ts:
  //   --proxy  >  pin in instances.json  >  --proxy-file  >  direct
  // Selection is keyed on this instanceId, and commands targeting a *different*
  // instance re-resolve rather than reusing what the process started with.
  const proxyBase: ProxyResolutionBase = {
    sessionPath,
    debug: debugMode,
    ...(explicitProxy && { explicitProxy }),
    ...(proxyFile && { proxyFile }),
    proxyStrategy,
  };

  // A failure here is reported but does NOT exit. A bad pin would otherwise
  // lock the operator out of `instance unset-proxy` and `instance ls` - the
  // commands that repair it. The config instead carries `proxyError`, and
  // createClient() refuses to build a client, so nothing connects direct.
  let clientConfig;
  let resolvedProxy;
  try {
    // Resolve once, then build the config from that result: resolving twice
    // would print every override warning twice.
    resolvedProxy = await resolveProxyForInstance(proxyBase, instanceId);
    clientConfig = configFromResolved(proxyBase, instanceId, resolvedProxy);
  } catch (error: unknown) {
    const reason = getErrorMessage(error);
    console.error(`❌ ${reason}`);
    console.error(
      `   Commands needing a connection will refuse until this is fixed; ` +
        `"instance unset-proxy ${instanceId}" removes the pin.`
    );
    resolvedProxy = { source: "none" as const };
    clientConfig = {
      ...configFromResolved(proxyBase, instanceId, resolvedProxy),
      proxyError: reason,
    };
  }

  const proxyUrl = clientConfig.proxy;

  // No command provided - start REPL
  if (!command) {
    console.log(`\n🚀 Starting miaw-cli REPL...`);
    console.log(`📂 Instance: ${instanceId}`);
    console.log(`📂 Session: ${sessionPath}`);
    if (proxyUrl) {
      console.log(
        `🌐 Proxy: ${maskProxyUrl(proxyUrl)} (${describeProxySource(resolvedProxy.source)})`
      );
    }
    console.log(`🔧 Debug: ${debugMode ? "ON" : "OFF"}\n`);

    try {
      await runRepl(clientConfig);
    } catch (error: unknown) {
      console.error("❌ REPL error:", getErrorMessage(error));
      process.exit(1);
    }
    return;
  }

  // Run one-shot command
  try {
    const success = await runCommand(command, commandArgs, {
      clientConfig,
      jsonOutput,
      flags,
      ...(proxyFile && { proxyFile }),
      proxyStrategy,
    });

    if (!success) {
      process.exit(1);
    }
  } catch (error: unknown) {
    console.error("❌ Command error:", getErrorMessage(error));
    if (debugMode && error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the CLI
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
