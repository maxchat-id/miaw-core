/**
 * Chat Management Commands (v1.7.0)
 *
 * Archive, pin, mute, mark read/unread, clear, and delete chats via chatModify.
 */

import { MiawClient } from "../../index.js";
import { ensureConnected } from "../utils/session.js";
import { formatMessage } from "../utils/formatter.js";
import type { MiawMessage, PinDurationValue } from "../../types/index.js";

/** Run a chat-management operation and report the result. */
async function runChatOp(
  client: MiawClient,
  jid: string,
  gerund: string,
  op: () => Promise<{ success: boolean; error?: string }>
): Promise<boolean> {
  const conn = await ensureConnected(client);
  if (!conn.success) {
    console.log(`❌ Not connected: ${conn.reason}`);
    return false;
  }

  console.log(`💬 ${gerund} ${jid}...`);
  const res = await op();

  if (res.success) {
    console.log(formatMessage(true, `${gerund} done`));
    return true;
  }
  console.log(formatMessage(false, `Failed: ${gerund.toLowerCase()}`, res.error));
  return false;
}

export const cmdChatArchive = (client: MiawClient, args: { jid: string }) =>
  runChatOp(client, args.jid, "Archiving", () => client.archiveChat(args.jid));

export const cmdChatUnarchive = (client: MiawClient, args: { jid: string }) =>
  runChatOp(client, args.jid, "Unarchiving", () => client.unarchiveChat(args.jid));

export const cmdChatPin = (client: MiawClient, args: { jid: string }) =>
  runChatOp(client, args.jid, "Pinning", () => client.pinChat(args.jid));

export const cmdChatUnpin = (client: MiawClient, args: { jid: string }) =>
  runChatOp(client, args.jid, "Unpinning", () => client.unpinChat(args.jid));

export const cmdChatMute = (client: MiawClient, args: { jid: string; duration?: number }) =>
  runChatOp(client, args.jid, "Muting", () => client.muteChat(args.jid, args.duration));

export const cmdChatUnmute = (client: MiawClient, args: { jid: string }) =>
  runChatOp(client, args.jid, "Unmuting", () => client.unmuteChat(args.jid));

export const cmdChatRead = (client: MiawClient, args: { jid: string }) =>
  runChatOp(client, args.jid, "Marking read", () => client.markChatRead(args.jid));

export const cmdChatUnread = (client: MiawClient, args: { jid: string }) =>
  runChatOp(client, args.jid, "Marking unread", () => client.markChatUnread(args.jid));

export const cmdChatClear = (client: MiawClient, args: { jid: string }) =>
  runChatOp(client, args.jid, "Clearing", () => client.clearChat(args.jid));

export const cmdChatDelete = (client: MiawClient, args: { jid: string }) =>
  runChatOp(client, args.jid, "Deleting", () => client.deleteChat(args.jid));

export const cmdChatEphemeral = (
  client: MiawClient,
  args: { jid: string; seconds: number }
) =>
  runChatOp(
    client,
    args.jid,
    args.seconds === 0
      ? "Disabling disappearing messages for"
      : `Setting ${args.seconds}s disappearing messages for`,
    () => client.setChatEphemeral(args.jid, args.seconds)
  );

/**
 * Look up a message in a chat's store by id.
 *
 * Pinning needs the raw Baileys key, which only lives on messages miaw-core has
 * actually seen — the same constraint `media download` works under.
 */
async function findMessage(
  client: MiawClient,
  jid: string,
  messageId: string
): Promise<MiawMessage | null> {
  const fetched = await client.getChatMessages(jid);
  if (!fetched.success || !fetched.messages) {
    console.log(`❌ Failed to fetch messages from ${jid}`);
    return null;
  }

  const message = fetched.messages.find((m) => m.id === messageId);
  if (!message) {
    console.log(`❌ Message not found: ${messageId}`);
    console.log(`   Tip: Use 'get messages ${jid}' to see available messages`);
    return null;
  }

  if (!message.raw) {
    console.log("❌ Message does not contain the raw data needed to pin it");
    console.log("   Note: only messages this session has seen carry it");
    return null;
  }

  return message;
}

/**
 * Pin or unpin a message in a chat
 */
export async function cmdChatPinMessage(
  client: MiawClient,
  args: { jid: string; messageId: string; pin: boolean; duration?: PinDurationValue }
): Promise<boolean> {
  const conn = await ensureConnected(client);
  if (!conn.success) {
    console.log(`❌ Not connected: ${conn.reason}`);
    return false;
  }

  const message = await findMessage(client, args.jid, args.messageId);
  if (!message) return false;

  const result = args.pin
    ? await client.pinMessage(message, args.duration)
    : await client.unpinMessage(message);

  console.log(
    formatMessage(
      result.success,
      result.success
        ? `Message ${args.pin ? "pinned" : "unpinned"}`
        : `Failed to ${args.pin ? "pin" : "unpin"} message`,
      result.error
    )
  );
  return result.success;
}
