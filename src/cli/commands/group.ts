/**
 * Group Commands
 *
 * Commands for group management (info, participants, invite-link, create, list)
 */

import { MiawClient } from "../../index.js";
import { ensureConnected } from "../utils/session.js";
import { formatTable, formatKeyValue, formatMessage, formatJson } from "../utils/formatter.js";

/**
 * List all groups (with optional filter and limit)
 */
export async function cmdGroupList(
  client: MiawClient,
  args: { limit?: number; filter?: string },
  jsonOutput: boolean
): Promise<boolean> {
  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Not connected: ${result.reason}`);
    return false;
  }

  const fetchResult = await client.fetchAllGroups();
  if (!fetchResult.success) {
    console.log("❌ Failed to fetch groups");
    return false;
  }

  let groups = fetchResult.groups || [];
  const totalCount = groups.length;

  // Apply filter (case-insensitive substring match)
  if (args.filter) {
    const filterLower = args.filter.toLowerCase();
    groups = groups.filter((g) =>
      g.jid?.toLowerCase().includes(filterLower) ||
      g.name?.toLowerCase().includes(filterLower) ||
      g.description?.toLowerCase().includes(filterLower)
    );
  }

  // Apply limit
  if (args.limit && args.limit < groups.length) {
    groups = groups.slice(0, args.limit);
  }

  if (jsonOutput) {
    console.log(formatJson(groups));
    return true;
  }

  const filterInfo = args.filter ? ` matching "${args.filter}"` : "";
  console.log(`\n👥 Groups (${groups.length}${filterInfo}):\n`);

  const tableData = groups.map((g) => ({
    jid: g.jid,
    name: g.name,
    participants: g.participantCount,
    description: g.description || "-",
  }));

  console.log(
    formatTable(tableData, [
      { key: "jid", label: "JID", width: 40 },
      { key: "name", label: "Name", width: 25 },
      { key: "participants", label: "Members", width: 10 },
      { key: "description", label: "Description", width: 30, truncate: 25 },
    ])
  );

  if (args.limit && groups.length >= args.limit) {
    console.log(`\nShowing ${args.limit} of ${totalCount} groups`);
  }

  return true;
}

/**
 * Get group info
 */
export async function cmdGroupInfo(
  client: MiawClient,
  args: { jid: string },
  jsonOutput: boolean
): Promise<boolean> {
  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Not connected: ${result.reason}`);
    return false;
  }

  if (!jsonOutput) {
    console.log(`👥 Getting group info for ${args.jid}...`);
  }

  const info = await client.getGroupInfo(args.jid);
  if (!info) {
    console.log(`❌ Failed to get group info for ${args.jid}`);
    return false;
  }

  if (jsonOutput) {
    console.log(JSON.stringify(info, null, 2));
    return true;
  }

  console.log(formatKeyValue(info, `👥 Group: ${info.name}`));
  return true;
}

/**
 * Get group participants
 */
export async function cmdGroupParticipants(
  client: MiawClient,
  args: { jid: string; limit?: number; filter?: string },
  jsonOutput: boolean
): Promise<boolean> {
  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Not connected: ${result.reason}`);
    return false;
  }

  if (!jsonOutput) {
    console.log(`👥 Getting participants for ${args.jid}...`);
  }

  const participantsResult = await client.getGroupParticipants(args.jid);
  if (!participantsResult) {
    console.log(`❌ Failed to get participants for ${args.jid}`);
    return false;
  }

  // Get contact info to enrich participants with name and phone
  const contactsResult = await client.fetchAllContacts();
  const contactsMap = new Map<string, { name?: string; phone?: string }>();
  if (contactsResult.success && contactsResult.contacts) {
    for (const contact of contactsResult.contacts) {
      contactsMap.set(contact.jid, { name: contact.name, phone: contact.phone });
    }
  }

  // Enrich participants with contact info
  let participants = participantsResult.map((p) => {
    // Resolve LID JID to phone JID if possible
    const resolvedJid = client.resolveLidToJid(p.jid);

    // Try to find contact by resolved JID (for name lookup)
    const contact = contactsMap.get(resolvedJid) || contactsMap.get(p.jid);

    // Get phone number using proper LID resolution
    const phone = client.getPhoneFromJid(p.jid);

    return {
      jid: resolvedJid !== p.jid ? resolvedJid : p.jid,
      phone: phone || contact?.phone || "-",
      name: contact?.name || "-",
      role: p.role,
    };
  });

  const totalCount = participants.length;

  // Apply filter (case-insensitive substring match)
  if (args.filter) {
    const filterLower = args.filter.toLowerCase();
    participants = participants.filter((p) =>
      p.jid?.toLowerCase().includes(filterLower) ||
      p.phone?.toLowerCase().includes(filterLower) ||
      p.name?.toLowerCase().includes(filterLower) ||
      p.role?.toLowerCase().includes(filterLower)
    );
  }

  // Apply limit
  if (args.limit && args.limit < participants.length) {
    participants = participants.slice(0, args.limit);
  }

  if (jsonOutput) {
    console.log(formatJson(participants));
    return true;
  }

  const filterInfo = args.filter ? ` matching "${args.filter}"` : "";
  console.log(`\n👥 Participants (${participants.length}${filterInfo}):\n`);

  const tableData = participants.map((p) => ({
    jid: p.jid,
    phone: p.phone,
    name: p.name,
    role: p.role,
  }));

  console.log(
    formatTable(tableData, [
      { key: "jid", label: "JID", width: 35 },
      { key: "phone", label: "Phone", width: 15 },
      { key: "name", label: "Name", width: 20 },
      { key: "role", label: "Role", width: 10 },
    ])
  );

  const admins = participants.filter((p) => p.role !== "member");
  console.log(`\nAdmins: ${admins.length}`);
  console.log(`Members: ${participants.length - admins.length}`);

  if (args.limit && participants.length >= args.limit) {
    console.log(`\nShowing ${args.limit} of ${totalCount} participants`);
  }

  return true;
}

/**
 * Get group invite link
 */
export async function cmdGroupInviteLink(
  client: MiawClient,
  args: { jid: string }
): Promise<boolean> {
  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Not connected: ${result.reason}`);
    return false;
  }

  console.log(`🔗 Getting invite link for ${args.jid}...`);

  const link = await client.getGroupInviteLink(args.jid);
  if (!link) {
    console.log(`❌ Failed to get invite link for ${args.jid}`);
    return false;
  }

  console.log(`\n🔗 Invite Link:\n${link}\n`);
  return true;
}

/**
 * Create new group
 */
export async function cmdGroupCreate(
  client: MiawClient,
  args: { name: string; phones: string[] }
): Promise<boolean> {
  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Not connected: ${result.reason}`);
    return false;
  }

  if (args.phones.length < 2) {
    console.log(`❌ At least 2 participants required to create a group`);
    return false;
  }

  console.log(`👥 Creating group "${args.name}" with ${args.phones.length} participants...`);

  const createResult = await client.createGroup(args.name, args.phones);

  if (createResult.success) {
    console.log(
      formatMessage(
        true,
        "Group created successfully",
        `Group JID: ${createResult.groupJid}`
      )
    );
    return true;
  }

  console.log(formatMessage(false, "Failed to create group", createResult.error));
  return false;
}

/**
 * Leave a group
 */
export async function cmdGroupLeave(
  client: MiawClient,
  args: { jid: string }
): Promise<boolean> {
  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Not connected: ${result.reason}`);
    return false;
  }

  console.log(`👋 Leaving group ${args.jid}...`);

  const leaveResult = await client.leaveGroup(args.jid);

  if (leaveResult.success) {
    console.log(formatMessage(true, "Left group successfully"));
    return true;
  }

  console.log(formatMessage(false, "Failed to leave group", leaveResult.error));
  return false;
}

/**
 * Accept group invite (join via invite code)
 */
export async function cmdGroupInviteAccept(
  client: MiawClient,
  args: { code: string }
): Promise<boolean> {
  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Not connected: ${result.reason}`);
    return false;
  }

  console.log(`🔗 Accepting invite code: ${args.code}...`);

  const groupJid = await client.acceptGroupInvite(args.code);

  if (groupJid) {
    console.log(formatMessage(true, "Joined group successfully", `Group JID: ${groupJid}`));
    return true;
  }

  console.log(formatMessage(false, "Failed to join group via invite code"));
  return false;
}

/**
 * Revoke group invite link (generates new link)
 */
export async function cmdGroupInviteRevoke(
  client: MiawClient,
  args: { jid: string }
): Promise<boolean> {
  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Not connected: ${result.reason}`);
    return false;
  }

  console.log(`🔄 Revoking invite link for ${args.jid}...`);

  const newLink = await client.revokeGroupInvite(args.jid);

  if (newLink) {
    console.log(formatMessage(true, "Invite link revoked", `New link: ${newLink}`));
    return true;
  }

  console.log(formatMessage(false, "Failed to revoke invite link"));
  return false;
}

/**
 * Get group info from invite code (without joining)
 */
export async function cmdGroupInviteInfo(
  client: MiawClient,
  args: { code: string },
  jsonOutput: boolean
): Promise<boolean> {
  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Not connected: ${result.reason}`);
    return false;
  }

  if (!jsonOutput) {
    console.log(`🔍 Getting group info for invite code: ${args.code}...`);
  }

  const info = await client.getGroupInviteInfo(args.code);

  if (!info) {
    console.log(formatMessage(false, "Failed to get group info from invite code"));
    return false;
  }

  if (jsonOutput) {
    console.log(JSON.stringify(info, null, 2));
    return true;
  }

  console.log(formatKeyValue(info, `👥 Group Info (from invite)`));
  return true;
}

/**
 * Add participants to a group
 */
export async function cmdGroupParticipantsAdd(
  client: MiawClient,
  args: { jid: string; phones: string[] }
): Promise<boolean> {
  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Not connected: ${result.reason}`);
    return false;
  }

  console.log(`➕ Adding ${args.phones.length} participant(s) to ${args.jid}...`);

  const results = await client.addParticipants(args.jid, args.phones);

  let successCount = 0;
  let failCount = 0;

  for (const r of results) {
    if (r.success) {
      console.log(`  ✅ ${r.jid}: Added`);
      successCount++;
    } else {
      console.log(`  ❌ ${r.jid}: Failed (status: ${r.status})`);
      failCount++;
    }
  }

  console.log(`\nResult: ${successCount} added, ${failCount} failed`);
  return failCount === 0;
}

/**
 * Remove participants from a group
 */
export async function cmdGroupParticipantsRemove(
  client: MiawClient,
  args: { jid: string; phones: string[] }
): Promise<boolean> {
  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Not connected: ${result.reason}`);
    return false;
  }

  console.log(`➖ Removing ${args.phones.length} participant(s) from ${args.jid}...`);

  const results = await client.removeParticipants(args.jid, args.phones);

  let successCount = 0;
  let failCount = 0;

  for (const r of results) {
    if (r.success) {
      console.log(`  ✅ ${r.jid}: Removed`);
      successCount++;
    } else {
      console.log(`  ❌ ${r.jid}: Failed (status: ${r.status})`);
      failCount++;
    }
  }

  console.log(`\nResult: ${successCount} removed, ${failCount} failed`);
  return failCount === 0;
}

/**
 * Promote participants to admin
 */
export async function cmdGroupParticipantsPromote(
  client: MiawClient,
  args: { jid: string; phones: string[] }
): Promise<boolean> {
  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Not connected: ${result.reason}`);
    return false;
  }

  console.log(`⬆️ Promoting ${args.phones.length} participant(s) to admin in ${args.jid}...`);

  const results = await client.promoteToAdmin(args.jid, args.phones);

  let successCount = 0;
  let failCount = 0;

  for (const r of results) {
    if (r.success) {
      console.log(`  ✅ ${r.jid}: Promoted to admin`);
      successCount++;
    } else {
      console.log(`  ❌ ${r.jid}: Failed (status: ${r.status})`);
      failCount++;
    }
  }

  console.log(`\nResult: ${successCount} promoted, ${failCount} failed`);
  return failCount === 0;
}

/**
 * Demote admins to regular member
 */
export async function cmdGroupParticipantsDemote(
  client: MiawClient,
  args: { jid: string; phones: string[] }
): Promise<boolean> {
  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Not connected: ${result.reason}`);
    return false;
  }

  console.log(`⬇️ Demoting ${args.phones.length} admin(s) to member in ${args.jid}...`);

  const results = await client.demoteFromAdmin(args.jid, args.phones);

  let successCount = 0;
  let failCount = 0;

  for (const r of results) {
    if (r.success) {
      console.log(`  ✅ ${r.jid}: Demoted to member`);
      successCount++;
    } else {
      console.log(`  ❌ ${r.jid}: Failed (status: ${r.status})`);
      failCount++;
    }
  }

  console.log(`\nResult: ${successCount} demoted, ${failCount} failed`);
  return failCount === 0;
}

/**
 * Update group name/subject
 */
export async function cmdGroupNameSet(
  client: MiawClient,
  args: { jid: string; name: string }
): Promise<boolean> {
  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Not connected: ${result.reason}`);
    return false;
  }

  console.log(`✏️ Updating group name to "${args.name}"...`);

  const updateResult = await client.updateGroupName(args.jid, args.name);

  if (updateResult.success) {
    console.log(formatMessage(true, "Group name updated successfully"));
    return true;
  }

  console.log(formatMessage(false, "Failed to update group name", updateResult.error));
  return false;
}

/**
 * Update group description
 */
export async function cmdGroupDescriptionSet(
  client: MiawClient,
  args: { jid: string; description?: string }
): Promise<boolean> {
  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Not connected: ${result.reason}`);
    return false;
  }

  const descText = args.description || "(empty)";
  console.log(`✏️ Updating group description to "${descText}"...`);

  const updateResult = await client.updateGroupDescription(args.jid, args.description);

  if (updateResult.success) {
    console.log(formatMessage(true, "Group description updated successfully"));
    return true;
  }

  console.log(formatMessage(false, "Failed to update group description", updateResult.error));
  return false;
}

/**
 * Update group picture
 */
export async function cmdGroupPictureSet(
  client: MiawClient,
  args: { jid: string; path: string }
): Promise<boolean> {
  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Not connected: ${result.reason}`);
    return false;
  }

  console.log(`🖼️ Updating group picture from ${args.path}...`);

  const updateResult = await client.updateGroupPicture(args.jid, args.path);

  if (updateResult.success) {
    console.log(formatMessage(true, "Group picture updated successfully"));
    return true;
  }

  console.log(formatMessage(false, "Failed to update group picture", updateResult.error));
  return false;
}

// ============================================
// Group Settings & Join Requests (v1.12.0)
// ============================================

/**
 * Restrict who may send messages in a group (announce-only mode)
 */
export async function cmdGroupAnnounce(
  client: MiawClient,
  args: { jid: string; on: boolean }
): Promise<boolean> {
  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Not connected: ${result.reason}`);
    return false;
  }

  console.log(
    `🔒 ${args.on ? "Restricting" : "Allowing"} messages ${args.on ? "to admins only" : "from everyone"}...`
  );

  const updateResult = await client.setGroupAnnounceOnly(args.jid, args.on);

  if (updateResult.success) {
    console.log(
      formatMessage(
        true,
        args.on ? "Group set to admins-only messaging" : "Group open to all members"
      )
    );
    return true;
  }

  console.log(formatMessage(false, "Failed to update announce mode", updateResult.error));
  return false;
}

/**
 * Restrict who may edit group info (subject, description, picture)
 */
export async function cmdGroupRestrict(
  client: MiawClient,
  args: { jid: string; on: boolean }
): Promise<boolean> {
  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Not connected: ${result.reason}`);
    return false;
  }

  console.log(`🔒 ${args.on ? "Locking" : "Unlocking"} group info editing...`);

  const updateResult = await client.setGroupRestrictInfo(args.jid, args.on);

  if (updateResult.success) {
    console.log(
      formatMessage(
        true,
        args.on ? "Only admins can edit group info" : "All members can edit group info"
      )
    );
    return true;
  }

  console.log(formatMessage(false, "Failed to update info restriction", updateResult.error));
  return false;
}

/**
 * Set who may add new members to a group
 */
export async function cmdGroupAddMode(
  client: MiawClient,
  args: { jid: string; mode: "admin_add" | "all_member_add" }
): Promise<boolean> {
  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Not connected: ${result.reason}`);
    return false;
  }

  console.log(`👤 Setting member-add mode to ${args.mode}...`);

  const updateResult = await client.setGroupMemberAddMode(args.jid, args.mode);

  if (updateResult.success) {
    console.log(formatMessage(true, `Member-add mode set to ${args.mode}`));
    return true;
  }

  console.log(formatMessage(false, "Failed to update member-add mode", updateResult.error));
  return false;
}

/**
 * Require admin approval for people joining via invite link
 */
export async function cmdGroupApprovalMode(
  client: MiawClient,
  args: { jid: string; on: boolean }
): Promise<boolean> {
  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Not connected: ${result.reason}`);
    return false;
  }

  console.log(`✅ Turning join approval ${args.on ? "on" : "off"}...`);

  const updateResult = await client.setGroupJoinApproval(args.jid, args.on);

  if (updateResult.success) {
    console.log(
      formatMessage(true, `Join approval ${args.on ? "required" : "not required"}`)
    );
    return true;
  }

  console.log(formatMessage(false, "Failed to update join approval", updateResult.error));
  return false;
}

/**
 * Set the disappearing-message timer for a group
 */
export async function cmdGroupEphemeral(
  client: MiawClient,
  args: { jid: string; seconds: number }
): Promise<boolean> {
  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Not connected: ${result.reason}`);
    return false;
  }

  console.log(
    args.seconds === 0
      ? "⏳ Disabling disappearing messages..."
      : `⏳ Setting disappearing messages to ${args.seconds}s...`
  );

  const updateResult = await client.setGroupEphemeral(args.jid, args.seconds);

  if (updateResult.success) {
    console.log(
      formatMessage(
        true,
        args.seconds === 0
          ? "Disappearing messages disabled"
          : `Disappearing messages set to ${args.seconds}s`
      )
    );
    return true;
  }

  console.log(
    formatMessage(false, "Failed to update disappearing messages", updateResult.error)
  );
  return false;
}

/**
 * List pending requests to join a group
 */
export async function cmdGroupRequestsList(
  client: MiawClient,
  args: { jid: string },
  jsonOutput: boolean
): Promise<boolean> {
  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Not connected: ${result.reason}`);
    return false;
  }

  const requests = await client.getGroupJoinRequests(args.jid);

  if (jsonOutput) {
    console.log(formatJson(requests));
    return true;
  }

  if (requests.length === 0) {
    console.log("\n📭 No pending join requests\n");
    return true;
  }

  console.log(`\n📥 Join requests (${requests.length}):\n`);
  console.log(
    formatTable(
      requests.map((r) => ({
        jid: r.jid,
        requested: r.requestedAt
          ? new Date(r.requestedAt * 1000).toISOString()
          : "-",
      })),
      [
        { key: "jid", label: "JID", width: 40 },
        { key: "requested", label: "Requested", width: 26 },
      ]
    )
  );
  return true;
}

/**
 * Approve or reject pending join requests
 */
export async function cmdGroupRequestsDecide(
  client: MiawClient,
  args: { jid: string; phones: string[]; action: "approve" | "reject" }
): Promise<boolean> {
  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Not connected: ${result.reason}`);
    return false;
  }

  console.log(`⏳ ${args.action === "approve" ? "Approving" : "Rejecting"} ${args.phones.length} request(s)...`);

  const results =
    args.action === "approve"
      ? await client.approveGroupJoinRequests(args.jid, args.phones)
      : await client.rejectGroupJoinRequests(args.jid, args.phones);

  console.log(
    formatTable(
      results.map((r) => ({
        jid: r.jid,
        status: r.status,
        result: r.success ? "✅" : "❌",
      })),
      [
        { key: "jid", label: "JID", width: 40 },
        { key: "status", label: "Status", width: 10 },
        { key: "result", label: "", width: 8 },
      ]
    )
  );

  return results.every((r) => r.success);
}
