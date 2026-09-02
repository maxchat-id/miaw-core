/**
 * Privacy & Blocklist Commands (v1.12.0)
 *
 * Read and change your own privacy settings, and manage the blocklist.
 */

import { MiawClient } from "../../index.js";
import { ensureConnected } from "../utils/session.js";
import {
  formatTable,
  formatKeyValue,
  formatMessage,
  formatJson,
} from "../utils/formatter.js";
import type {
  PrivacyValue,
  PrivacyOnlineValue,
  PrivacyGroupAddValue,
  ReadReceiptsValue,
  PrivacyCallValue,
  PrivacyMessagesValue,
} from "../../types/index.js";

async function requireConn(client: MiawClient): Promise<boolean> {
  const r = await ensureConnected(client);
  if (!r.success) {
    console.log(`❌ Not connected: ${r.reason}`);
    return false;
  }
  return true;
}

/**
 * Show current privacy settings
 */
export async function cmdPrivacyShow(
  client: MiawClient,
  args: { force?: boolean },
  jsonOutput: boolean
): Promise<boolean> {
  if (!(await requireConn(client))) return false;

  const settings = await client.getPrivacySettings(args.force);
  if (!settings) {
    console.log("❌ Failed to fetch privacy settings");
    return false;
  }

  if (jsonOutput) {
    console.log(formatJson(settings));
    return true;
  }

  console.log("\n🔐 Privacy Settings:\n");
  console.log(
    formatKeyValue({
      "Last seen": settings.lastSeen ?? "-",
      Online: settings.online ?? "-",
      "Profile picture": settings.profilePicture ?? "-",
      Status: settings.status ?? "-",
      "Read receipts": settings.readReceipts ?? "-",
      "Group add": settings.groupAdd ?? "-",
      Messages: settings.messages ?? "-",
      Calls: settings.calls ?? "-",
    })
  );
  return true;
}

/** The privacy settings that can be changed, and the values each accepts. */
export const PRIVACY_SETTINGS = {
  "last-seen": {
    values: ["all", "contacts", "contact_blacklist", "none"],
    apply: (client: MiawClient, v: string) =>
      client.setLastSeenPrivacy(v as PrivacyValue),
  },
  online: {
    values: ["all", "match_last_seen"],
    apply: (client: MiawClient, v: string) =>
      client.setOnlinePrivacy(v as PrivacyOnlineValue),
  },
  picture: {
    values: ["all", "contacts", "contact_blacklist", "none"],
    apply: (client: MiawClient, v: string) =>
      client.setProfilePicturePrivacy(v as PrivacyValue),
  },
  status: {
    values: ["all", "contacts", "contact_blacklist", "none"],
    apply: (client: MiawClient, v: string) =>
      client.setStatusPrivacy(v as PrivacyValue),
  },
  "read-receipts": {
    values: ["all", "none"],
    apply: (client: MiawClient, v: string) =>
      client.setReadReceiptsPrivacy(v as ReadReceiptsValue),
  },
  "group-add": {
    values: ["all", "contacts", "contact_blacklist"],
    apply: (client: MiawClient, v: string) =>
      client.setGroupAddPrivacy(v as PrivacyGroupAddValue),
  },
  messages: {
    values: ["all", "contacts"],
    apply: (client: MiawClient, v: string) =>
      client.setMessagesPrivacy(v as PrivacyMessagesValue),
  },
  calls: {
    values: ["all", "known"],
    apply: (client: MiawClient, v: string) =>
      client.setCallPrivacy(v as PrivacyCallValue),
  },
} as const;

export type PrivacySettingName = keyof typeof PRIVACY_SETTINGS;

/**
 * Change one privacy setting.
 *
 * The accepted values differ per setting, so they are validated here rather
 * than at the router: sending WhatsApp an out-of-range value fails opaquely,
 * and a wrong-but-valid value silently changes the wrong thing.
 */
export async function cmdPrivacySet(
  client: MiawClient,
  args: { setting: string; value: string }
): Promise<boolean> {
  const setting = PRIVACY_SETTINGS[args.setting as PrivacySettingName];
  if (!setting) {
    console.log(`❌ Unknown privacy setting: ${args.setting}`);
    console.log(`   Settings: ${Object.keys(PRIVACY_SETTINGS).join(", ")}`);
    return false;
  }

  if (!(setting.values as readonly string[]).includes(args.value)) {
    console.log(`❌ Invalid value for ${args.setting}: ${args.value}`);
    console.log(`   Accepted: ${setting.values.join(", ")}`);
    return false;
  }

  if (!(await requireConn(client))) return false;

  const result = await setting.apply(client, args.value);
  console.log(
    formatMessage(
      result.success,
      result.success
        ? `${args.setting} privacy set to ${args.value}`
        : `Failed to set ${args.setting} privacy`,
      result.error
    )
  );
  return result.success;
}

/**
 * Set the default disappearing-message timer for NEW chats
 */
export async function cmdPrivacyDisappearing(
  client: MiawClient,
  args: { seconds: number }
): Promise<boolean> {
  if (!(await requireConn(client))) return false;

  const result = await client.setDefaultDisappearingMode(args.seconds);
  console.log(
    formatMessage(
      result.success,
      result.success
        ? args.seconds === 0
          ? "Default disappearing messages disabled"
          : `Default disappearing messages set to ${args.seconds}s (new chats only)`
        : "Failed to set default disappearing mode",
      result.error
    )
  );
  return result.success;
}

/**
 * Turn link previews on or off for messages you send
 */
export async function cmdPrivacyLinkPreviews(
  client: MiawClient,
  args: { on: boolean }
): Promise<boolean> {
  if (!(await requireConn(client))) return false;

  // The client method is phrased as "disabled", the CLI as "on" -- invert here
  // so the command reads the way a user expects.
  const result = await client.setLinkPreviewsDisabled(!args.on);
  console.log(
    formatMessage(
      result.success,
      result.success
        ? `Link previews ${args.on ? "enabled" : "disabled"}`
        : "Failed to update link previews",
      result.error
    )
  );
  return result.success;
}

/**
 * List blocked contacts
 */
export async function cmdBlockList(
  client: MiawClient,
  jsonOutput: boolean
): Promise<boolean> {
  if (!(await requireConn(client))) return false;

  const blocked = await client.getBlocklist();

  if (jsonOutput) {
    console.log(formatJson(blocked));
    return true;
  }

  if (blocked.length === 0) {
    console.log("\n✅ No blocked contacts\n");
    return true;
  }

  console.log(`\n🚫 Blocked contacts (${blocked.length}):\n`);
  console.log(
    formatTable(
      blocked.map((jid) => ({ jid })),
      [{ key: "jid", label: "JID", width: 40 }]
    )
  );
  return true;
}

/**
 * Block or unblock a contact
 */
export async function cmdBlockSet(
  client: MiawClient,
  args: { phone: string; block: boolean }
): Promise<boolean> {
  if (!(await requireConn(client))) return false;

  const result = args.block
    ? await client.blockContact(args.phone)
    : await client.unblockContact(args.phone);

  console.log(
    formatMessage(
      result.success,
      result.success
        ? `${args.phone} ${args.block ? "blocked" : "unblocked"}`
        : `Failed to ${args.block ? "block" : "unblock"} ${args.phone}`,
      result.error
    )
  );
  return result.success;
}
