/**
 * Command Router
 *
 * Routes commands to appropriate handlers
 */

import { getOrCreateClient } from "../utils/client-cache.js";
import { defaultCLIContext } from "../context.js";
import { PinDuration } from "../../types/index.js";
import type { PinDurationValue } from "../../types/index.js";
import {
  parseToggle,
  parseEphemeral,
  parseMemberAddMode,
} from "../utils/parse-args.js";

/** The three pin-in-chat durations WhatsApp accepts, by CLI alias. */
const PIN_DURATIONS: Record<string, PinDurationValue> = {
  "24h": PinDuration.TwentyFourHours,
  "7d": PinDuration.SevenDays,
  "30d": PinDuration.ThirtyDays,
};

/** Subcommand list printed by `group` with no/unknown subcommand. */
export const GROUP_COMMANDS =
  "Commands: list, info, create, leave, participants, invite, invite-link, " +
  "name, description, picture, announce, restrict, add-mode, approval, " +
  "ephemeral, requests";

/** Subcommand list printed by `community` with no/unknown subcommand. */
export const COMMUNITY_COMMANDS =
  "Commands: list, info, create, leave, name, description, linked, link, " +
  "unlink, group, members, invite, invite-link, announce, restrict, " +
  "add-mode, approval, ephemeral, requests";
import {
  // Instance commands
  cmdInstanceList,
  cmdInstanceStatus,
  cmdInstanceCreate,
  cmdInstanceDelete,
  cmdInstanceConnect,
  cmdInstanceDisconnect,
  cmdInstanceLogout,
  // Get commands
  cmdGetProfile,
  cmdGetContacts,
  cmdGetGroups,
  cmdGetChats,
  cmdGetMessages,
  cmdLoadMoreMessages,
  cmdGetLabels,
  // Send commands
  cmdSendText,
  cmdSendImage,
  cmdSendDocument,
  cmdSendVideo,
  cmdSendAudio,
  cmdSendLocation,
  cmdSendContact,
  cmdSendPoll,
  cmdSendSticker,
  cmdSendGroupInvite,
  // Chat management commands
  cmdChatArchive,
  cmdChatUnarchive,
  cmdChatPin,
  cmdChatUnpin,
  cmdChatEphemeral,
  cmdChatPinMessage,
  // Privacy & blocklist (v1.12.0)
  cmdPrivacyShow,
  cmdPrivacySet,
  cmdPrivacyDisappearing,
  cmdPrivacyLinkPreviews,
  cmdBlockList,
  cmdBlockSet,
  PRIVACY_SETTINGS,
  // Calls (v1.12.0)
  cmdCallLink,
  cmdChatMute,
  cmdChatUnmute,
  cmdChatRead,
  cmdChatUnread,
  cmdChatClear,
  cmdChatDelete,
  // Status commands
  cmdStatusText,
  cmdStatusImage,
  cmdStatusVideo,
  // Business commands
  cmdBusinessProfile,
  cmdBusinessCoverSet,
  cmdBusinessCoverRemove,
  // Community commands
  cmdCommunityList,
  cmdCommunityInfo,
  cmdCommunityCreate,
  cmdCommunityLeave,
  cmdCommunityNameSet,
  cmdCommunityDescriptionSet,
  cmdCommunityLinked,
  cmdCommunityLink,
  cmdCommunityUnlink,
  cmdCommunityGroupCreate,
  cmdCommunityMembers,
  cmdCommunityMembersAdd,
  cmdCommunityMembersRemove,
  cmdCommunityMembersPromote,
  cmdCommunityMembersDemote,
  cmdCommunityInviteLink,
  cmdCommunityInviteRevoke,
  cmdCommunityInviteAccept,
  cmdCommunityInviteInfo,
  // Community admin (v1.12.0)
  cmdCommunityAnnounce,
  cmdCommunityRestrict,
  cmdCommunityAddMode,
  cmdCommunityApprovalMode,
  cmdCommunityEphemeral,
  cmdCommunityRequestsList,
  cmdCommunityRequestsDecide,
  // Media commands
  cmdMediaDownload,
  // Group commands
  cmdGroupList,
  cmdGroupInfo,
  cmdGroupParticipants,
  cmdGroupInviteLink,
  cmdGroupCreate,
  cmdGroupLeave,
  cmdGroupInviteAccept,
  cmdGroupInviteRevoke,
  cmdGroupInviteInfo,
  cmdGroupParticipantsAdd,
  cmdGroupParticipantsRemove,
  cmdGroupParticipantsPromote,
  cmdGroupParticipantsDemote,
  cmdGroupNameSet,
  cmdGroupDescriptionSet,
  cmdGroupPictureSet,
  // Group admin (v1.12.0)
  cmdGroupAnnounce,
  cmdGroupRestrict,
  cmdGroupAddMode,
  cmdGroupApprovalMode,
  cmdGroupEphemeral,
  cmdGroupRequestsList,
  cmdGroupRequestsDecide,
  // Misc commands
  cmdCheck,
  // Contact commands
  cmdContactList,
  cmdContactInfo,
  cmdContactBusiness,
  cmdContactPicture,
  cmdContactAdd,
  cmdContactRemove,
  // Profile commands
  cmdProfilePictureSet,
  cmdProfilePictureRemove,
  cmdProfileNameSet,
  cmdProfileStatusSet,
  // Label commands (Business)
  cmdLabelAdd,
  cmdLabelChats,
  cmdLabelChatAdd,
  cmdLabelChatRemove,
  // Catalog commands (Business)
  cmdCatalogList,
  cmdCatalogCollections,
  cmdCatalogProductCreate,
  cmdCatalogProductUpdate,
  cmdCatalogProductDelete,
  // Proxy commands (no connection required)
  cmdProxyList,
  cmdProxyTest,
  cmdProxyTestAll,
  cmdInstanceSetProxy,
  cmdInstanceUnsetProxy,
} from "./commands-index.js";
import { parseProxyStrategy, resolveProxyFile } from "../utils/proxy-config.js";
import { getErrorMessage } from "../../utils/type-guards.js";
import {
  configFromResolved,
  resolveProxyForInstance,
  type ProxyResolutionBase,
  type ProxySource,
} from "../utils/proxy-resolver.js";
import type { ProxyRotationStrategy } from "../../utils/proxy-rotator.js";
import type { ClientConfig } from "../utils/session.js";

export interface CommandContext {
  /**
   * Fully-resolved config for the *startup* instance. Commands targeting a
   * different instance must re-resolve rather than reuse this - see the
   * `instance` block below.
   */
  clientConfig: ClientConfig;
  jsonOutput?: boolean;
  flags?: { [key: string]: string | boolean };
  /** Proxy list file from --proxy-file, for the `proxy` commands. */
  proxyFile?: string;
  /** Selection strategy from --proxy-strategy. */
  proxyStrategy?: string;
}

/**
 * Run a command
 */
export async function runCommand(
  command: string,
  args: string[],
  context: CommandContext
): Promise<boolean | { success: boolean; switchToInstance?: string }> {
  const { clientConfig, jsonOutput = false } = context;

  // Parse flags from args
  const parsedArgs = parseCommandArgs(args);

  // Instance commands (don't require connection).
  // Must stay ABOVE getOrCreateClient() so no client is built for the STARTUP
  // instance when the command targets a different one.
  if (command === "instance") {
    // Wrapped because the pin store throws on a corrupt instances.json rather
    // than treating it as empty - treating it as empty would connect direct and
    // leak the real IP. That refusal must read as a CLI error, not a stack trace.
    try {
      const subCommand = parsedArgs._[0] || "";
      const subArgs = parsedArgs._.slice(1);
      const targetId = subArgs[0] || clientConfig.instanceId;

      // Flags arrive from two places: one-shot mode strips every --flag in
      // bin/miaw-cli.ts before calling runCommand (so they land in context.flags),
      // while the REPL passes the raw tokenized line (so they land in parsedArgs).
      // Both must be read or the flag silently no-ops.
      const flag = (name: string): string | boolean | undefined =>
        parsedArgs[name] ?? context.flags?.[name];
      const strFlag = (name: string): string | undefined => {
        const value = flag(name);
        return typeof value === "string" ? value : undefined;
      };

      const proxyFile = resolveProxyFile(parsedArgs, context.flags, context.proxyFile);
      let proxyStrategy: ProxyRotationStrategy;
      try {
        proxyStrategy = parseProxyStrategy(context.proxyStrategy ?? strFlag("proxy-strategy"));
      } catch (error) {
        console.log(`❌ ${getErrorMessage(error)}`);
        return false;
      }

      // These need no proxy resolution at all - handle them before paying for it.
      switch (subCommand) {
        case "ls":
        case "list":
          return await cmdInstanceList(clientConfig.sessionPath, jsonOutput);
        case "set-proxy":
          if (!subArgs[0]) {
            console.log(
              "❌ Usage: miaw-cli instance set-proxy <id> <url|--label L|--from-file|--from-env VAR>"
            );
            return false;
          }
          return await cmdInstanceSetProxy(
            clientConfig.sessionPath,
            subArgs[0],
            {
              // A positional url, else --proxy (bin/miaw-cli.ts swallows it as a
              // global flag, so it would otherwise never reach this command).
              ...(subArgs[1] ? { url: subArgs[1] } : {}),
              ...(strFlag("label") ? { label: strFlag("label") } : {}),
              ...(flag("from-file") === true ? { fromFile: true } : {}),
              ...(strFlag("from-env") ? { fromEnv: strFlag("from-env") } : {}),
              ...(!subArgs[1] &&
              !strFlag("label") &&
              flag("from-file") !== true &&
              !strFlag("from-env") &&
              strFlag("proxy")
                ? { url: strFlag("proxy") }
                : {}),
            },
            { ...(proxyFile ? { proxyFile } : {}), proxyStrategy }
          );
        case "unset-proxy":
          if (!subArgs[0]) {
            console.log("❌ Usage: miaw-cli instance unset-proxy <id>");
            return false;
          }
          return await cmdInstanceUnsetProxy(clientConfig.sessionPath, subArgs[0], jsonOutput);
      }

      // The rest construct or inspect a client, so resolve the proxy for the
      // TARGET instance rather than reusing whatever the process started with.
      const base: ProxyResolutionBase = {
        sessionPath: clientConfig.sessionPath,
        ...(clientConfig.debug !== undefined ? { debug: clientConfig.debug } : {}),
        ...(strFlag("proxy") ?? clientConfig.explicitProxy
          ? { explicitProxy: strFlag("proxy") ?? clientConfig.explicitProxy }
          : {}),
        ...(proxyFile ? { proxyFile } : {}),
        proxyStrategy,
      };

      // Validate the subcommand and its arguments BEFORE resolving a proxy.
      // Resolving first meant `instance create` with no id, or an unknown
      // subcommand, could fail with "Proxy resolution failed" instead of the
      // usage error the user actually needed (and 09-instance-commands.test.ts
      // asserts on).
      const NEEDS_ID = new Set(["create", "delete", "connect", "disconnect", "logout"]);
      const KNOWN = new Set([...NEEDS_ID, "status"]);

      if (!KNOWN.has(subCommand)) {
        if (!subCommand) {
          console.log("Usage: instance <command>");
        } else {
          console.log(`❌ Unknown instance command: ${subCommand}`);
        }
        console.log(
          "Commands: ls, status, create, delete, connect, disconnect, logout, set-proxy, unset-proxy"
        );
        return false;
      }

      if (NEEDS_ID.has(subCommand) && !subArgs[0]) {
        console.log(`❌ Usage: miaw-cli instance ${subCommand} <id>`);
        return false;
      }

      // Resolve for the TARGET instance. Quiet when the target is the instance
      // the CLI already resolved at startup: the result is identical and
      // re-announcing every override warning on each command is just noise.
      let targetConfig: ClientConfig;
      let proxySource: ProxySource;
      try {
        const resolved = await resolveProxyForInstance(base, targetId, {
          quiet: targetId === clientConfig.instanceId,
        });
        proxySource = resolved.source;
        targetConfig = configFromResolved(base, targetId, resolved);
      } catch (error) {
        console.log(`❌ Proxy resolution failed: ${getErrorMessage(error)}`);
        return false;
      }

      switch (subCommand) {
        case "status":
          return await cmdInstanceStatus(targetConfig, targetId, defaultCLIContext, proxySource);
        case "create":
          return await cmdInstanceCreate(targetConfig);
        case "delete":
          return await cmdInstanceDelete(targetConfig);
        case "connect":
          return await cmdInstanceConnect(targetConfig);
        case "disconnect":
          return await cmdInstanceDisconnect(targetConfig, clientConfig.instanceId);
        case "logout":
          return await cmdInstanceLogout(targetConfig, clientConfig.instanceId);
        default:
          // Unreachable: KNOWN is checked above.
          return false;
      }
    } catch (error) {
      console.log(`❌ ${getErrorMessage(error)}`);
      return false;
    }
  }

  // Proxy commands (don't require connection - they probe the proxy directly).
  // Must stay ABOVE getOrCreateClient() so no client is ever constructed.
  if (command === "proxy") {
    const subCommand = parsedArgs._[0] || "";
    const subArgs = parsedArgs._.slice(1);
    const proxyFile = resolveProxyFile(parsedArgs, context.flags, context.proxyFile);

    // Flags arrive from two different places: one-shot mode strips every
    // --flag in bin/miaw-cli.ts before calling runCommand (so they land in
    // context.flags), while the REPL passes the raw tokenized line (so they
    // land in parsedArgs). Both must be read or the flag silently no-ops.
    const showIp = parsedArgs.ip === true || context.flags?.ip === true;
    const rawTimeout = parsedArgs.timeout ?? context.flags?.timeout;
    const timeoutMs =
      typeof rawTimeout === "number"
        ? rawTimeout
        : typeof rawTimeout === "string" && /^\d+$/.test(rawTimeout)
          ? Number(rawTimeout)
          : undefined;

    const probeOptions = {
      showIp,
      ...(timeoutMs !== undefined && { timeoutMs }),
    };

    switch (subCommand) {
      case "ls":
      case "list":
        return await cmdProxyList(proxyFile, jsonOutput);
      case "test":
        return await cmdProxyTest(
          subArgs[0] || (context.flags?.proxy as string) || clientConfig.proxy,
          probeOptions,
          jsonOutput
        );
      case "test-all":
        return await cmdProxyTestAll(proxyFile, probeOptions, jsonOutput);
      default:
        if (!subCommand) {
          console.log("Usage: proxy <command>");
        } else {
          console.log(`❌ Unknown proxy command: ${subCommand}`);
        }
        console.log("Commands: list, test, test-all");
        return false;
    }
  }

  // Create or get cached client for commands that need connection
  const client = getOrCreateClient(clientConfig);

  // Get commands
  if (command === "get") {
    const subCommand = parsedArgs._[0] || "";

    switch (subCommand) {
      case "profile":
        return await cmdGetProfile(client, { jid: parsedArgs._[1] }, jsonOutput);
      case "contacts":
        return await cmdGetContacts(client, { limit: parsedArgs.limit, filter: parsedArgs.filter }, jsonOutput);
      case "groups":
        return await cmdGetGroups(client, { limit: parsedArgs.limit, filter: parsedArgs.filter }, jsonOutput);
      case "chats":
        return await cmdGetChats(client, { limit: parsedArgs.limit, filter: parsedArgs.filter }, jsonOutput);
      case "messages":
        if (!parsedArgs._[1]) {
          console.log("❌ Usage: miaw-cli get messages <jid> [--limit N] [--filter TEXT]");
          return false;
        }
        return await cmdGetMessages(
          client,
          { jid: parsedArgs._[1], limit: parsedArgs.limit, filter: parsedArgs.filter },
          jsonOutput
        );
      case "labels":
        return await cmdGetLabels(client, jsonOutput);
      default:
        if (!subCommand) {
          console.log("Usage: get <command>");
          console.log("Commands: profile, contacts, groups, chats, messages, labels");
        } else {
          console.log(`❌ Unknown get command: ${subCommand}`);
          console.log("Commands: profile, contacts, groups, chats, messages, labels");
        }
        return false;
    }
  }

  // Send commands
  if (command === "send") {
    const subCommand = parsedArgs._[0] || "";

    switch (subCommand) {
      case "text":
        if (parsedArgs._.length < 3) {
          console.log("❌ Usage: miaw-cli send text <phone> <message>");
          return false;
        }
        return await cmdSendText(client, {
          phone: parsedArgs._[1],
          message: parsedArgs._.slice(2).join(" "),
        });
      case "image":
        if (parsedArgs._.length < 3) {
          console.log("❌ Usage: miaw-cli send image <phone> <path> [caption]");
          return false;
        }
        return await cmdSendImage(client, {
          phone: parsedArgs._[1],
          path: parsedArgs._[2],
          caption: parsedArgs._[3],
        });
      case "document":
        if (parsedArgs._.length < 3) {
          console.log("❌ Usage: miaw-cli send document <phone> <path> [caption]");
          return false;
        }
        return await cmdSendDocument(client, {
          phone: parsedArgs._[1],
          path: parsedArgs._[2],
          caption: parsedArgs._[3],
        });
      case "video":
        if (parsedArgs._.length < 3) {
          console.log("❌ Usage: miaw-cli send video <phone> <path> [--caption <text>] [--gif] [--ptv]");
          return false;
        }
        return await cmdSendVideo(client, {
          phone: parsedArgs._[1],
          path: parsedArgs._[2],
          caption: parsedArgs.caption,
          gif: parsedArgs.gif,
          ptv: parsedArgs.ptv,
        });
      case "audio":
        if (parsedArgs._.length < 3) {
          console.log("❌ Usage: miaw-cli send audio <phone> <path> [--ptt]");
          return false;
        }
        return await cmdSendAudio(client, {
          phone: parsedArgs._[1],
          path: parsedArgs._[2],
          ptt: parsedArgs.ptt,
        });
      case "location":
        if (parsedArgs._.length < 4) {
          console.log("❌ Usage: miaw-cli send location <phone> <lat> <lng> [--name <n>] [--address <a>]");
          return false;
        }
        return await cmdSendLocation(client, {
          phone: parsedArgs._[1],
          latitude: parseFloat(parsedArgs._[2]),
          longitude: parseFloat(parsedArgs._[3]),
          name: parsedArgs.name,
          address: parsedArgs.address,
        });
      case "contact":
        if (parsedArgs._.length < 4) {
          console.log("❌ Usage: miaw-cli send contact <phone> <fullName> <contactPhone> [--org <o>]");
          return false;
        }
        return await cmdSendContact(client, {
          phone: parsedArgs._[1],
          fullName: parsedArgs._[2],
          contactPhone: parsedArgs._[3],
          org: parsedArgs.org,
        });
      case "poll":
        if (parsedArgs._.length < 4) {
          console.log("❌ Usage: miaw-cli send poll <phone> <name> <option1> <option2> [...] [--select <n>]");
          return false;
        }
        return await cmdSendPoll(client, {
          phone: parsedArgs._[1],
          name: parsedArgs._[2],
          options: parsedArgs._.slice(3),
          selectableCount: parsedArgs.select ? parseInt(parsedArgs.select, 10) : undefined,
        });
      case "group-invite":
        if (parsedArgs._.length < 3) {
          console.log("❌ Usage: miaw-cli send group-invite <phone> <groupJid> [caption]");
          return false;
        }
        return await cmdSendGroupInvite(client, {
          phone: parsedArgs._[1],
          groupJid: parsedArgs._[2],
          caption: parsedArgs._.slice(3).join(" ") || undefined,
        });

      case "sticker":
        if (parsedArgs._.length < 3) {
          console.log("❌ Usage: miaw-cli send sticker <phone> <path-or-url>");
          return false;
        }
        return await cmdSendSticker(client, {
          phone: parsedArgs._[1],
          path: parsedArgs._[2],
        });
      default:
        if (!subCommand) {
          console.log("Usage: send <command> <phone> <message|path>");
          console.log("Commands: text, image, document, video, audio, location, contact, poll, sticker");
        } else {
          console.log(`❌ Unknown send command: ${subCommand}`);
          console.log("Commands: text, image, document, video, audio, location, contact, poll, sticker");
        }
        return false;
    }
  }

  // Chat management commands
  // Calls (v1.12.0)
  if (command === "call") {
    const subCommand = parsedArgs._[0] || "";

    switch (subCommand) {
      case "link": {
        const type = (parsedArgs._[1] || "video").toLowerCase();
        if (type !== "audio" && type !== "video") {
          console.log("❌ Usage: miaw-cli call link [audio|video] [--start <unix-seconds>]");
          return false;
        }
        const start = parsedArgs.start ?? context.flags?.start;
        if (start !== undefined && typeof start !== "number") {
          console.log("❌ --start must be a Unix timestamp in seconds");
          return false;
        }
        return await cmdCallLink(client, { type, startTime: start });
      }

      default:
        console.log(`❌ Unknown call command: ${subCommand}`);
        console.log("Commands: link");
        return false;
    }
  }

  // Privacy settings (v1.12.0)
  if (command === "privacy") {
    const subCommand = parsedArgs._[0] || "";

    switch (subCommand) {
      case "show":
      case "": {
        const force = Boolean(parsedArgs.force ?? context.flags?.force);
        return await cmdPrivacyShow(client, { force }, jsonOutput);
      }

      case "set":
        if (parsedArgs._.length < 3) {
          console.log("❌ Usage: miaw-cli privacy set <setting> <value>");
          console.log(`   Settings: ${Object.keys(PRIVACY_SETTINGS).join(", ")}`);
          return false;
        }
        return await cmdPrivacySet(client, {
          setting: parsedArgs._[1],
          value: parsedArgs._[2],
        });

      case "disappearing": {
        const seconds = parseEphemeral(parsedArgs._[1]);
        if (seconds === null) {
          console.log("❌ Usage: miaw-cli privacy disappearing <off|24h|7d|90d|seconds>");
          return false;
        }
        return await cmdPrivacyDisappearing(client, { seconds });
      }

      case "link-previews": {
        const on = parseToggle(parsedArgs._[1]);
        if (on === null) {
          console.log("❌ Usage: miaw-cli privacy link-previews <on|off>");
          return false;
        }
        return await cmdPrivacyLinkPreviews(client, { on });
      }

      default:
        console.log(`❌ Unknown privacy command: ${subCommand}`);
        console.log("Commands: show, set, disappearing, link-previews");
        return false;
    }
  }

  // Blocklist (v1.12.0)
  if (command === "block") {
    const subCommand = parsedArgs._[0] || "";

    switch (subCommand) {
      case "list":
      case "ls":
        return await cmdBlockList(client, jsonOutput);

      case "add":
        if (!parsedArgs._[1]) {
          console.log("❌ Usage: miaw-cli block add <phone>");
          return false;
        }
        return await cmdBlockSet(client, {
          phone: parsedArgs._[1],
          block: true,
        });

      case "remove":
      case "rm":
        if (!parsedArgs._[1]) {
          console.log("❌ Usage: miaw-cli block remove <phone>");
          return false;
        }
        return await cmdBlockSet(client, {
          phone: parsedArgs._[1],
          block: false,
        });

      default:
        console.log(`❌ Unknown block command: ${subCommand}`);
        console.log("Commands: list, add, remove");
        return false;
    }
  }

  if (command === "chat") {
    const subCommand = parsedArgs._[0] || "";
    const jid = parsedArgs._[1] || "";

    if (subCommand && subCommand !== "help" && !jid) {
      console.log(`❌ Usage: miaw-cli chat ${subCommand} <jid|phone>`);
      return false;
    }

    switch (subCommand) {
      case "archive":
        return await cmdChatArchive(client, { jid });
      case "unarchive":
        return await cmdChatUnarchive(client, { jid });
      case "pin":
        return await cmdChatPin(client, { jid });
      case "unpin":
        return await cmdChatUnpin(client, { jid });
      case "mute":
        return await cmdChatMute(client, {
          jid,
          duration: parsedArgs.duration
            ? parseInt(parsedArgs.duration, 10)
            : undefined,
        });
      case "unmute":
        return await cmdChatUnmute(client, { jid });
      case "read":
        return await cmdChatRead(client, { jid });
      case "unread":
        return await cmdChatUnread(client, { jid });
      case "clear":
        return await cmdChatClear(client, { jid });
      case "delete":
        return await cmdChatDelete(client, { jid });
      case "ephemeral": {
        const seconds = parseEphemeral(parsedArgs._[2]);
        if (seconds === null) {
          console.log("❌ Usage: miaw-cli chat ephemeral <jid|phone> <off|24h|7d|90d|seconds>");
          return false;
        }
        return await cmdChatEphemeral(client, { jid, seconds });
      }
      case "pin-message":
      case "unpin-message": {
        const pin = subCommand === "pin-message";
        if (!parsedArgs._[2]) {
          console.log(`❌ Usage: miaw-cli chat ${subCommand} <jid|phone> <messageId>${pin ? " [24h|7d|30d]" : ""}`);
          return false;
        }
        let duration: PinDurationValue | undefined;
        if (pin && parsedArgs._[3]) {
          const parsed = PIN_DURATIONS[parsedArgs._[3].toLowerCase()];
          if (parsed === undefined) {
            console.log("❌ Usage: miaw-cli chat pin-message <jid|phone> <messageId> [24h|7d|30d]");
            return false;
          }
          duration = parsed;
        }
        return await cmdChatPinMessage(client, {
          jid,
          messageId: parsedArgs._[2],
          pin,
          duration,
        });
      }
      default:
        if (subCommand) {
          console.log(`❌ Unknown chat command: ${subCommand}`);
        } else {
          console.log("Usage: chat <command> <jid|phone> [--duration <ms> for mute]");
        }
        console.log(
          "Commands: archive, unarchive, pin, unpin, mute, unmute, read, unread, clear, delete, ephemeral, pin-message, unpin-message"
        );
        return false;
    }
  }

  // Status / Stories commands (named `story` to avoid the `status` REPL command)
  if (command === "story") {
    const subCommand = parsedArgs._[0] || "";

    switch (subCommand) {
      case "text":
        if (parsedArgs._.length < 2) {
          console.log("❌ Usage: miaw-cli story text <text> [--recipients a,b] [--bg <color>] [--font <n>]");
          return false;
        }
        return await cmdStatusText(client, {
          text: parsedArgs._.slice(1).join(" "),
          recipients: parsedArgs.recipients,
          bg: parsedArgs.bg,
          font: parsedArgs.font ? parseInt(parsedArgs.font, 10) : undefined,
        });
      case "image":
        if (parsedArgs._.length < 2) {
          console.log("❌ Usage: miaw-cli story image <path> [--recipients a,b] [--caption <t>]");
          return false;
        }
        return await cmdStatusImage(client, {
          path: parsedArgs._[1],
          recipients: parsedArgs.recipients,
          caption: parsedArgs.caption,
        });
      case "video":
        if (parsedArgs._.length < 2) {
          console.log("❌ Usage: miaw-cli story video <path> [--recipients a,b] [--caption <t>]");
          return false;
        }
        return await cmdStatusVideo(client, {
          path: parsedArgs._[1],
          recipients: parsedArgs.recipients,
          caption: parsedArgs.caption,
        });
      default:
        if (subCommand) {
          console.log(`❌ Unknown story command: ${subCommand}`);
        } else {
          console.log("Usage: story <text|image|video> ... [--recipients a,b]");
        }
        console.log("Commands: text, image, video");
        return false;
    }
  }

  // Media commands
  if (command === "media") {
    const subCommand = parsedArgs._[0] || "";

    switch (subCommand) {
      case "download":
        if (parsedArgs._.length < 4) {
          console.log("❌ Usage: miaw-cli media download <jid> <messageId> <output-path>");
          return false;
        }
        return await cmdMediaDownload(client, {
          jid: parsedArgs._[1],
          messageId: parsedArgs._[2],
          outputPath: parsedArgs._[3],
        });
      default:
        if (!subCommand) {
          console.log("Usage: media <command>");
          console.log("Commands: download");
        } else {
          console.log(`❌ Unknown media command: ${subCommand}`);
          console.log("Commands: download");
        }
        return false;
    }
  }

  // Group commands
  if (command === "group") {
    const subCommand = parsedArgs._[0] || "";
    const subSubCommand = parsedArgs._[1] || "";

    switch (subCommand) {
      case "list":
      case "ls":
        return await cmdGroupList(client, { limit: parsedArgs.limit, filter: parsedArgs.filter }, jsonOutput);

      case "info":
        if (!parsedArgs._[1]) {
          console.log("❌ Usage: miaw-cli group info <jid>");
          return false;
        }
        return await cmdGroupInfo(client, { jid: parsedArgs._[1] }, jsonOutput);

      case "create":
        if (parsedArgs._.length < 3) {
          console.log("❌ Usage: miaw-cli group create <name> <phone1> <phone2> ...");
          return false;
        }
        return await cmdGroupCreate(client, {
          name: parsedArgs._[1],
          phones: parsedArgs._.slice(2),
        });

      case "leave":
        if (!parsedArgs._[1]) {
          console.log("❌ Usage: miaw-cli group leave <jid>");
          return false;
        }
        return await cmdGroupLeave(client, { jid: parsedArgs._[1] });

      // Nested invite commands
      case "invite":
        switch (subSubCommand) {
          case "accept":
            if (!parsedArgs._[2]) {
              console.log("❌ Usage: miaw-cli group invite accept <code>");
              return false;
            }
            return await cmdGroupInviteAccept(client, { code: parsedArgs._[2] });
          case "revoke":
            if (!parsedArgs._[2]) {
              console.log("❌ Usage: miaw-cli group invite revoke <jid>");
              return false;
            }
            return await cmdGroupInviteRevoke(client, { jid: parsedArgs._[2] });
          case "info":
            if (!parsedArgs._[2]) {
              console.log("❌ Usage: miaw-cli group invite info <code>");
              return false;
            }
            return await cmdGroupInviteInfo(client, { code: parsedArgs._[2] }, jsonOutput);
          default:
            console.log("❌ Unknown invite command. Usage:");
            console.log("   group invite accept <code>   Join group via invite code");
            console.log("   group invite revoke <jid>    Revoke and get new invite link");
            console.log("   group invite info <code>     Get group info from invite code");
            return false;
        }

      // Backward compatibility: invite-link
      case "invite-link":
        if (!parsedArgs._[1]) {
          console.log("❌ Usage: miaw-cli group invite-link <jid>");
          return false;
        }
        return await cmdGroupInviteLink(client, { jid: parsedArgs._[1] });

      // Nested participants commands
      case "participants":
        switch (subSubCommand) {
          case "add":
            if (parsedArgs._.length < 4) {
              console.log("❌ Usage: miaw-cli group participants add <jid> <phone1> [phone2] ...");
              return false;
            }
            return await cmdGroupParticipantsAdd(client, {
              jid: parsedArgs._[2],
              phones: parsedArgs._.slice(3),
            });
          case "remove":
            if (parsedArgs._.length < 4) {
              console.log("❌ Usage: miaw-cli group participants remove <jid> <phone1> [phone2] ...");
              return false;
            }
            return await cmdGroupParticipantsRemove(client, {
              jid: parsedArgs._[2],
              phones: parsedArgs._.slice(3),
            });
          case "promote":
            if (parsedArgs._.length < 4) {
              console.log("❌ Usage: miaw-cli group participants promote <jid> <phone1> [phone2] ...");
              return false;
            }
            return await cmdGroupParticipantsPromote(client, {
              jid: parsedArgs._[2],
              phones: parsedArgs._.slice(3),
            });
          case "demote":
            if (parsedArgs._.length < 4) {
              console.log("❌ Usage: miaw-cli group participants demote <jid> <phone1> [phone2] ...");
              return false;
            }
            return await cmdGroupParticipantsDemote(client, {
              jid: parsedArgs._[2],
              phones: parsedArgs._.slice(3),
            });
          default:
            // List participants (original behavior)
            if (!subSubCommand) {
              console.log("❌ Usage: miaw-cli group participants <jid> [--limit N] [--filter TEXT]");
              return false;
            }
            // subSubCommand is actually the JID in this case
            return await cmdGroupParticipants(
              client,
              { jid: subSubCommand, limit: parsedArgs.limit, filter: parsedArgs.filter },
              jsonOutput
            );
        }

      // Nested name command
      case "name":
        if (subSubCommand === "set") {
          if (parsedArgs._.length < 4) {
            console.log("❌ Usage: miaw-cli group name set <jid> <name>");
            return false;
          }
          return await cmdGroupNameSet(client, {
            jid: parsedArgs._[2],
            name: parsedArgs._.slice(3).join(" "),
          });
        }
        console.log("❌ Usage: miaw-cli group name set <jid> <name>");
        return false;

      // Nested description command
      case "description":
        if (subSubCommand === "set") {
          if (!parsedArgs._[2]) {
            console.log("❌ Usage: miaw-cli group description set <jid> [description]");
            return false;
          }
          return await cmdGroupDescriptionSet(client, {
            jid: parsedArgs._[2],
            description: parsedArgs._.slice(3).join(" ") || undefined,
          });
        }
        console.log("❌ Usage: miaw-cli group description set <jid> [description]");
        return false;

      // Nested picture command
      case "picture":
        if (subSubCommand === "set") {
          if (parsedArgs._.length < 4) {
            console.log("❌ Usage: miaw-cli group picture set <jid> <path>");
            return false;
          }
          return await cmdGroupPictureSet(client, {
            jid: parsedArgs._[2],
            path: parsedArgs._[3],
          });
        }
        console.log("❌ Usage: miaw-cli group picture set <jid> <path>");
        return false;

      // Settings (v1.12.0)
      case "announce": {
        const on = parseToggle(parsedArgs._[2]);
        if (!parsedArgs._[1] || on === null) {
          console.log("❌ Usage: miaw-cli group announce <jid> <on|off>");
          return false;
        }
        return await cmdGroupAnnounce(client, { jid: parsedArgs._[1], on });
      }

      case "restrict": {
        const on = parseToggle(parsedArgs._[2]);
        if (!parsedArgs._[1] || on === null) {
          console.log("❌ Usage: miaw-cli group restrict <jid> <on|off>");
          return false;
        }
        return await cmdGroupRestrict(client, { jid: parsedArgs._[1], on });
      }

      case "add-mode": {
        const mode = parseMemberAddMode(parsedArgs._[2]);
        if (!parsedArgs._[1] || mode === null) {
          console.log("❌ Usage: miaw-cli group add-mode <jid> <admin|all>");
          return false;
        }
        return await cmdGroupAddMode(client, { jid: parsedArgs._[1], mode });
      }

      case "approval": {
        const on = parseToggle(parsedArgs._[2]);
        if (!parsedArgs._[1] || on === null) {
          console.log("❌ Usage: miaw-cli group approval <jid> <on|off>");
          return false;
        }
        return await cmdGroupApprovalMode(client, { jid: parsedArgs._[1], on });
      }

      case "ephemeral": {
        const seconds = parseEphemeral(parsedArgs._[2]);
        if (!parsedArgs._[1] || seconds === null) {
          console.log("❌ Usage: miaw-cli group ephemeral <jid> <off|24h|7d|90d|seconds>");
          return false;
        }
        return await cmdGroupEphemeral(client, { jid: parsedArgs._[1], seconds });
      }

      // Nested join-request commands (v1.12.0)
      case "requests":
        switch (subSubCommand) {
          case "list":
          case "ls":
            if (!parsedArgs._[2]) {
              console.log("❌ Usage: miaw-cli group requests list <jid>");
              return false;
            }
            return await cmdGroupRequestsList(client, { jid: parsedArgs._[2] }, jsonOutput);
          case "approve":
            if (parsedArgs._.length < 4) {
              console.log("❌ Usage: miaw-cli group requests approve <jid> <phone1> [phone2] ...");
              return false;
            }
            return await cmdGroupRequestsDecide(client, {
              jid: parsedArgs._[2],
              phones: parsedArgs._.slice(3),
              action: "approve",
            });
          case "reject":
            if (parsedArgs._.length < 4) {
              console.log("❌ Usage: miaw-cli group requests reject <jid> <phone1> [phone2] ...");
              return false;
            }
            return await cmdGroupRequestsDecide(client, {
              jid: parsedArgs._[2],
              phones: parsedArgs._.slice(3),
              action: "reject",
            });
          default:
            console.log("❌ Usage: miaw-cli group requests <list|approve|reject> <jid> [phones...]");
            return false;
        }

      default:
        if (!subCommand) {
          console.log("Usage: group <command>");
          console.log(GROUP_COMMANDS);
        } else {
          console.log(`❌ Unknown group command: ${subCommand}`);
          console.log(GROUP_COMMANDS);
        }
        return false;
    }
  }

  // Check command
  if (command === "check") {
    if (parsedArgs._.length === 0) {
      console.log("❌ Usage: miaw-cli check <phone1> [phone2] ...");
      return false;
    }
    return await cmdCheck(client, { phones: parsedArgs._ }, jsonOutput);
  }

  // Contact commands
  if (command === "contact") {
    const subCommand = parsedArgs._[0] || "";

    switch (subCommand) {
      case "list":
      case "ls":
        return await cmdContactList(client, { limit: parsedArgs.limit, filter: parsedArgs.filter }, jsonOutput);

      case "info":
        if (!parsedArgs._[1]) {
          console.log("❌ Usage: miaw-cli contact info <phone>");
          return false;
        }
        return await cmdContactInfo(client, { phone: parsedArgs._[1] }, jsonOutput);

      case "business":
        if (!parsedArgs._[1]) {
          console.log("❌ Usage: miaw-cli contact business <phone>");
          return false;
        }
        return await cmdContactBusiness(client, { phone: parsedArgs._[1] }, jsonOutput);

      case "picture":
        if (!parsedArgs._[1]) {
          console.log("❌ Usage: miaw-cli contact picture <phone> [--high]");
          return false;
        }
        return await cmdContactPicture(client, { phone: parsedArgs._[1], high: parsedArgs.high });

      case "add":
        if (parsedArgs._.length < 3) {
          console.log("❌ Usage: miaw-cli contact add <phone> <name> [--first <firstName>] [--last <lastName>]");
          return false;
        }
        return await cmdContactAdd(client, {
          phone: parsedArgs._[1],
          name: parsedArgs._.slice(2).join(" "),
          first: parsedArgs.first,
          last: parsedArgs.last,
        });

      case "remove":
        if (!parsedArgs._[1]) {
          console.log("❌ Usage: miaw-cli contact remove <phone>");
          return false;
        }
        return await cmdContactRemove(client, { phone: parsedArgs._[1] });

      default:
        if (!subCommand) {
          console.log("Usage: contact <command>");
        } else {
          console.log(`❌ Unknown contact command: ${subCommand}`);
        }
        console.log("Commands: list, info, business, picture, add, remove");
        return false;
    }
  }

  // Profile commands
  if (command === "profile") {
    const subCommand = parsedArgs._[0] || "";
    const subSubCommand = parsedArgs._[1] || "";

    switch (subCommand) {
      case "picture":
        switch (subSubCommand) {
          case "set":
            if (!parsedArgs._[2]) {
              console.log("❌ Usage: miaw-cli profile picture set <path>");
              return false;
            }
            return await cmdProfilePictureSet(client, { path: parsedArgs._[2] });
          case "remove":
            return await cmdProfilePictureRemove(client);
          default:
            console.log("❌ Unknown profile picture command. Usage:");
            console.log("   profile picture set <path>     Set profile picture");
            console.log("   profile picture remove         Remove profile picture");
            return false;
        }

      case "name":
        if (subSubCommand === "set") {
          if (parsedArgs._.length < 3) {
            console.log("❌ Usage: miaw-cli profile name set <name>");
            return false;
          }
          return await cmdProfileNameSet(client, { name: parsedArgs._.slice(2).join(" ") });
        }
        console.log("❌ Usage: miaw-cli profile name set <name>");
        return false;

      case "status":
        if (subSubCommand === "set") {
          // Status can be empty to clear it
          return await cmdProfileStatusSet(client, { status: parsedArgs._.slice(2).join(" ") });
        }
        console.log("❌ Usage: miaw-cli profile status set <status>");
        return false;

      default:
        if (!subCommand) {
          console.log("Usage: profile <command> <subcommand>");
        } else {
          console.log(`❌ Unknown profile command: ${subCommand}`);
        }
        console.log("Commands: picture (set|remove), name set, status set");
        return false;
    }
  }

  // Label commands (Business)
  if (command === "label") {
    const subCommand = parsedArgs._[0] || "";
    const subSubCommand = parsedArgs._[1] || "";

    switch (subCommand) {
      case "list":
      case "ls":
        return await cmdGetLabels(client, jsonOutput);

      case "add":
        if (parsedArgs._.length < 3) {
          console.log("❌ Usage: miaw-cli label add <name> <color>");
          console.log("   Color: 0-19 or name (salmon, gold, yellow, mint, teal, cyan, sky, blue, purple, pink, etc.)");
          return false;
        }
        return await cmdLabelAdd(
          client,
          { name: parsedArgs._[1], color: parsedArgs._[2] },
          jsonOutput
        );

      case "chats":
        if (!parsedArgs._[1]) {
          console.log("❌ Usage: miaw-cli label chats <labelId>");
          console.log("   Use 'label list' to see available labels");
          return false;
        }
        return await cmdLabelChats(
          client,
          { labelId: parsedArgs._[1] },
          jsonOutput
        );

      case "chat":
        switch (subSubCommand) {
          case "add":
            if (parsedArgs._.length < 4) {
              console.log("❌ Usage: miaw-cli label chat add <jid> <labelId>");
              return false;
            }
            return await cmdLabelChatAdd(
              client,
              { jid: parsedArgs._[2], labelId: parsedArgs._[3] },
              jsonOutput
            );
          case "remove":
            if (parsedArgs._.length < 4) {
              console.log("❌ Usage: miaw-cli label chat remove <jid> <labelId>");
              return false;
            }
            return await cmdLabelChatRemove(
              client,
              { jid: parsedArgs._[2], labelId: parsedArgs._[3] },
              jsonOutput
            );
          default:
            if (!subSubCommand) {
              console.log("Usage: label chat <command>");
            } else {
              console.log(`❌ Unknown label chat command: ${subSubCommand}`);
            }
            console.log("Commands: add, remove");
            return false;
        }

      default:
        if (!subCommand) {
          console.log("Usage: label <command>");
        } else {
          console.log(`❌ Unknown label command: ${subCommand}`);
        }
        console.log("Commands: list, chats, add, chat (add|remove)");
        return false;
    }
  }

  // Community commands
  if (command === "community") {
    const subCommand = parsedArgs._[0] || "";
    const subSubCommand = parsedArgs._[1] || "";
    const jsonOutput = parsedArgs.json === true;

    switch (subCommand) {
      case "list":
      case "ls":
        return await cmdCommunityList(client, { json: jsonOutput });
      case "info":
        if (!parsedArgs._[1]) {
          console.log("❌ Usage: miaw-cli community info <jid>");
          return false;
        }
        return await cmdCommunityInfo(client, { jid: parsedArgs._[1], json: jsonOutput });
      case "create":
        if (!parsedArgs._[1]) {
          console.log("❌ Usage: miaw-cli community create <name> [description]");
          return false;
        }
        return await cmdCommunityCreate(client, {
          name: parsedArgs._[1],
          description: parsedArgs._[2],
        });
      case "leave":
        if (!parsedArgs._[1]) {
          console.log("❌ Usage: miaw-cli community leave <jid>");
          return false;
        }
        return await cmdCommunityLeave(client, { jid: parsedArgs._[1] });
      case "name":
        if (!parsedArgs._[1] || !parsedArgs._[2]) {
          console.log("❌ Usage: miaw-cli community name <jid> <name>");
          return false;
        }
        return await cmdCommunityNameSet(client, { jid: parsedArgs._[1], name: parsedArgs._.slice(2).join(" ") });
      case "description":
        if (!parsedArgs._[1]) {
          console.log("❌ Usage: miaw-cli community description <jid> <description>");
          return false;
        }
        return await cmdCommunityDescriptionSet(client, { jid: parsedArgs._[1], description: parsedArgs._.slice(2).join(" ") });
      case "linked":
        if (!parsedArgs._[1]) {
          console.log("❌ Usage: miaw-cli community linked <jid>");
          return false;
        }
        return await cmdCommunityLinked(client, { jid: parsedArgs._[1], json: jsonOutput });
      case "link":
        if (!parsedArgs._[1] || !parsedArgs._[2]) {
          console.log("❌ Usage: miaw-cli community link <groupJid> <communityJid>");
          return false;
        }
        return await cmdCommunityLink(client, { groupJid: parsedArgs._[1], communityJid: parsedArgs._[2] });
      case "unlink":
        if (!parsedArgs._[1] || !parsedArgs._[2]) {
          console.log("❌ Usage: miaw-cli community unlink <groupJid> <communityJid>");
          return false;
        }
        return await cmdCommunityUnlink(client, { groupJid: parsedArgs._[1], communityJid: parsedArgs._[2] });
      case "group":
        if (!parsedArgs._[1] || !parsedArgs._[2]) {
          console.log("❌ Usage: miaw-cli community group <communityJid> <name> [phones...]");
          return false;
        }
        return await cmdCommunityGroupCreate(client, {
          communityJid: parsedArgs._[1],
          name: parsedArgs._[2],
          phones: parsedArgs._.slice(3),
        });
      case "members":
        switch (subSubCommand) {
          case "add":
            return await cmdCommunityMembersAdd(client, { jid: parsedArgs._[2], phones: parsedArgs._.slice(3) });
          case "remove":
            return await cmdCommunityMembersRemove(client, { jid: parsedArgs._[2], phones: parsedArgs._.slice(3) });
          case "promote":
            return await cmdCommunityMembersPromote(client, { jid: parsedArgs._[2], phones: parsedArgs._.slice(3) });
          case "demote":
            return await cmdCommunityMembersDemote(client, { jid: parsedArgs._[2], phones: parsedArgs._.slice(3) });
          default:
            if (!parsedArgs._[1]) {
              console.log("❌ Usage: miaw-cli community members <jid> | members add|remove|promote|demote <jid> <phones...>");
              return false;
            }
            return await cmdCommunityMembers(client, { jid: parsedArgs._[1], json: jsonOutput });
        }
      case "invite":
        switch (subSubCommand) {
          case "link":
            return await cmdCommunityInviteLink(client, { jid: parsedArgs._[2] });
          case "revoke":
            return await cmdCommunityInviteRevoke(client, { jid: parsedArgs._[2] });
          case "accept":
            return await cmdCommunityInviteAccept(client, { code: parsedArgs._[2] });
          case "info":
            return await cmdCommunityInviteInfo(client, { code: parsedArgs._[2] });
          default:
            console.log("❌ Usage: miaw-cli community invite link|accept|revoke|info ...");
            return false;
        }

      // Backward compatibility: invite-link (mirrors `group invite-link`).
      // COMMUNITY_COMMANDS has advertised this since v1.9.0; without the case it
      // fell through to the unknown-command branch.
      case "invite-link":
        if (!parsedArgs._[1]) {
          console.log("❌ Usage: miaw-cli community invite-link <jid>");
          return false;
        }
        return await cmdCommunityInviteLink(client, { jid: parsedArgs._[1] });

      // Settings (v1.12.0)
      case "announce": {
        const on = parseToggle(parsedArgs._[2]);
        if (!parsedArgs._[1] || on === null) {
          console.log("❌ Usage: miaw-cli community announce <jid> <on|off>");
          return false;
        }
        return await cmdCommunityAnnounce(client, { jid: parsedArgs._[1], on });
      }

      case "restrict": {
        const on = parseToggle(parsedArgs._[2]);
        if (!parsedArgs._[1] || on === null) {
          console.log("❌ Usage: miaw-cli community restrict <jid> <on|off>");
          return false;
        }
        return await cmdCommunityRestrict(client, { jid: parsedArgs._[1], on });
      }

      case "add-mode": {
        const mode = parseMemberAddMode(parsedArgs._[2]);
        if (!parsedArgs._[1] || mode === null) {
          console.log("❌ Usage: miaw-cli community add-mode <jid> <admin|all>");
          return false;
        }
        return await cmdCommunityAddMode(client, { jid: parsedArgs._[1], mode });
      }

      case "approval": {
        const on = parseToggle(parsedArgs._[2]);
        if (!parsedArgs._[1] || on === null) {
          console.log("❌ Usage: miaw-cli community approval <jid> <on|off>");
          return false;
        }
        return await cmdCommunityApprovalMode(client, { jid: parsedArgs._[1], on });
      }

      case "ephemeral": {
        const seconds = parseEphemeral(parsedArgs._[2]);
        if (!parsedArgs._[1] || seconds === null) {
          console.log("❌ Usage: miaw-cli community ephemeral <jid> <off|24h|7d|90d|seconds>");
          return false;
        }
        return await cmdCommunityEphemeral(client, { jid: parsedArgs._[1], seconds });
      }

      // Nested join-request commands (v1.12.0)
      case "requests":
        switch (subSubCommand) {
          case "list":
          case "ls":
            if (!parsedArgs._[2]) {
              console.log("❌ Usage: miaw-cli community requests list <jid>");
              return false;
            }
            return await cmdCommunityRequestsList(client, { jid: parsedArgs._[2] }, jsonOutput);
          case "approve":
            if (parsedArgs._.length < 4) {
              console.log("❌ Usage: miaw-cli community requests approve <jid> <phone1> [phone2] ...");
              return false;
            }
            return await cmdCommunityRequestsDecide(client, {
              jid: parsedArgs._[2],
              phones: parsedArgs._.slice(3),
              action: "approve",
            });
          case "reject":
            if (parsedArgs._.length < 4) {
              console.log("❌ Usage: miaw-cli community requests reject <jid> <phone1> [phone2] ...");
              return false;
            }
            return await cmdCommunityRequestsDecide(client, {
              jid: parsedArgs._[2],
              phones: parsedArgs._.slice(3),
              action: "reject",
            });
          default:
            console.log("❌ Usage: miaw-cli community requests <list|approve|reject> <jid> [phones...]");
            return false;
        }

      default:
        if (subCommand) {
          console.log(`❌ Unknown community command: ${subCommand}`);
        } else {
          console.log("Usage: community <command> ...");
        }
        console.log(COMMUNITY_COMMANDS);
        return false;
    }
  }

  // Business commands (Business account)
  if (command === "business") {
    const subCommand = parsedArgs._[0] || "";
    const subSubCommand = parsedArgs._[1] || "";

    switch (subCommand) {
      case "profile":
        return await cmdBusinessProfile(client, {
          address: parsedArgs.address,
          email: parsedArgs.email,
          description: parsedArgs.description,
          websites: parsedArgs.websites,
        });
      case "cover":
        if (subSubCommand === "set") {
          if (!parsedArgs._[2]) {
            console.log("❌ Usage: miaw-cli business cover set <path>");
            return false;
          }
          return await cmdBusinessCoverSet(client, { path: parsedArgs._[2] });
        }
        if (subSubCommand === "remove") {
          if (!parsedArgs._[2]) {
            console.log("❌ Usage: miaw-cli business cover remove <coverPhotoId>");
            return false;
          }
          return await cmdBusinessCoverRemove(client, { id: parsedArgs._[2] });
        }
        console.log("❌ Usage: miaw-cli business cover set <path> | business cover remove <id>");
        return false;
      default:
        if (subCommand) {
          console.log(`❌ Unknown business command: ${subCommand}`);
        } else {
          console.log("Usage: business profile [--address --email --description --websites a,b] | business cover set|remove");
        }
        console.log("Commands: profile, cover (set|remove)");
        return false;
    }
  }

  // Catalog commands (Business)
  if (command === "catalog") {
    const subCommand = parsedArgs._[0] || "";
    const subSubCommand = parsedArgs._[1] || "";

    switch (subCommand) {
      case "list":
        return await cmdCatalogList(
          client,
          { phone: parsedArgs.phone, limit: parsedArgs.limit, cursor: parsedArgs.cursor },
          jsonOutput
        );

      case "collections":
        return await cmdCatalogCollections(
          client,
          { phone: parsedArgs.phone, limit: parsedArgs.limit },
          jsonOutput
        );

      case "product":
        switch (subSubCommand) {
          case "create":
            if (parsedArgs._.length < 6) {
              console.log("❌ Usage: miaw-cli catalog product create <name> <description> <price> <currency>");
              console.log("   Options: --image <path>, --url <url>, --retailerId <id>, --hidden");
              return false;
            }
            return await cmdCatalogProductCreate(
              client,
              {
                name: parsedArgs._[2],
                description: parsedArgs._[3],
                price: parseFloat(parsedArgs._[4]),
                currency: parsedArgs._[5],
                image: parsedArgs.image,
                url: parsedArgs.url,
                retailerId: parsedArgs.retailerId,
                hidden: parsedArgs.hidden,
              },
              jsonOutput
            );
          case "update":
            if (!parsedArgs._[2]) {
              console.log("❌ Usage: miaw-cli catalog product update <productId> [options]");
              console.log("   Options: --name <name>, --description <desc>, --price <price>, --currency <currency>");
              console.log("            --image <path>, --url <url>, --retailerId <id>, --hidden");
              return false;
            }
            return await cmdCatalogProductUpdate(
              client,
              {
                productId: parsedArgs._[2],
                name: parsedArgs.name,
                description: parsedArgs.description,
                price: parsedArgs.price,
                currency: parsedArgs.currency,
                image: parsedArgs.image,
                url: parsedArgs.url,
                retailerId: parsedArgs.retailerId,
                hidden: parsedArgs.hidden,
              },
              jsonOutput
            );
          case "delete":
            if (parsedArgs._.length < 3) {
              console.log("❌ Usage: miaw-cli catalog product delete <productId> [productId...]");
              return false;
            }
            return await cmdCatalogProductDelete(
              client,
              { productIds: parsedArgs._.slice(2) },
              jsonOutput
            );
          default:
            if (!subSubCommand) {
              console.log("Usage: catalog product <command>");
            } else {
              console.log(`❌ Unknown catalog product command: ${subSubCommand}`);
            }
            console.log("Commands: create, update, delete");
            return false;
        }

      default:
        if (!subCommand) {
          console.log("Usage: catalog <command>");
        } else {
          console.log(`❌ Unknown catalog command: ${subCommand}`);
        }
        console.log("Commands: list, collections, product (create|update|delete)");
        return false;
    }
  }

  // Load commands
  if (command === "load") {
    const subCommand = parsedArgs._[0] || "";

    switch (subCommand) {
      case "messages":
        if (!parsedArgs._[1]) {
          console.log("❌ Usage: miaw-cli load messages <jid> [--count N]");
          return false;
        }
        return await cmdLoadMoreMessages(
          client,
          { jid: parsedArgs._[1], count: parsedArgs.count },
          jsonOutput
        );
      default:
        if (!subCommand) {
          console.log("Usage: load <command>");
        } else {
          console.log(`❌ Unknown load command: ${subCommand}`);
        }
        console.log("Commands: messages");
        return false;
    }
  }

  console.log(`❌ Unknown command: ${command}`);
  console.log('Run "miaw-cli --help" for usage information');
  return false;
}

/**
 * Parse command arguments.
 * Only auto-converts known numeric flags to numbers; all others stay as strings.
 */
const NUMERIC_FLAGS = new Set(["limit", "count", "cursor", "timeout", "start"]);

function parseCommandArgs(args: string[]): any {
  const parsed: any = { _: [] };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith("--")) {
      const flagName = arg.slice(2);
      const nextArg = args[i + 1];

      if (nextArg && !nextArg.startsWith("--")) {
        if (NUMERIC_FLAGS.has(flagName)) {
          const numValue = parseInt(nextArg, 10);
          parsed[flagName] = isNaN(numValue) ? nextArg : numValue;
        } else {
          parsed[flagName] = nextArg;
        }
        i++;
      } else {
        parsed[flagName] = true;
      }
    } else {
      parsed._.push(arg);
    }
  }

  return parsed;
}
