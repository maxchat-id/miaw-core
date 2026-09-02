/**
 * Calls, Group Admin & Connection Identity Example (v1.12.0)
 *
 * Demonstrates the three things the rc14 / v1.12.0 release added that are
 * awkward to discover from the API reference alone:
 *
 * 1. The `call` event, and the narrow window in which rejectCall() works
 * 2. Group admin: announce-only, join approval, and the join-request queue
 * 3. BrowserPresets — choosing the identity WhatsApp sees this session as
 *
 * Run: npx tsx examples/12-calls-and-admin.ts
 */

import { MiawClient, BrowserPresets, EphemeralDuration } from "miaw-core";
import qrcode from "qrcode-terminal";

// ── Connection identity ─────────────────────────────────────────────────────
//
// The `browser` tuple is what WhatsApp shows under Linked Devices, and it also
// decides which handshake Baileys performs. The default is macOS/Chrome.
//
//   BrowserPresets.macOS("Chrome")   → ["Mac OS", "Chrome", "14.4.1"]   (default)
//   BrowserPresets.windows("Chrome") → ["Windows", "Chrome", "10.0.22631"]
//   BrowserPresets.ubuntu("Chrome")  → ["Ubuntu", "Chrome", "22.04.4"]
//   BrowserPresets.android("13")     → ["13", "Android", ""]
//
// The Android preset is not cosmetic: it makes Baileys negotiate as
// Platform.ANDROID. Baileys reports that this is required to RECEIVE
// view-once media, and flags it experimental. miaw-core has verified the
// handshake but NOT the view-once receipt — see docs/USAGE.md before
// depending on it. It also changes the device label on your phone and may
// alter history-sync depth, so the default is left alone here.
const client = new MiawClient({
  instanceId: "calls-admin-bot",
  sessionPath: "./sessions",
  browser: BrowserPresets.macOS("Chrome"),
});

client.on("qr", (qr) => qrcode.generate(qr, { small: true }));

// ── Calls ───────────────────────────────────────────────────────────────────
//
// One event covers the whole lifecycle; `status` says where you are in it.
// rejectCall() is only meaningful while the call is still ringing — that is,
// on status "offer". Calling it on "accept"/"reject"/"timeout" is too late,
// which is why the check below is not defensive noise.
client.on("call", async (call) => {
  console.log(
    `📞 ${call.status.padEnd(9)} from ${call.from}` +
      `${call.isVideo ? " (video)" : ""}${call.isGroup ? " (group)" : ""}`
  );

  if (call.status !== "offer") return;

  // Auto-reject everything. A real bot would decide per caller.
  const result = await client.rejectCall(call.id, call.from);
  console.log("   rejected:", result.success, result.error ?? "");
});

client.on("ready", async () => {
  console.log("✅ Connected\n");

  // A shareable call link. This mints a REAL artifact that anyone with the
  // URL can join, so it is left commented out.
  //
  // const link = await client.createCallLink("video");
  // console.log("Call link:", link);
  //
  // Pass a start time to schedule it:
  // await client.createCallLink("video", { startTime: 1767225600 });

  // ── Group admin ───────────────────────────────────────────────────────────
  const groupJid = process.env.EXAMPLE_GROUP_JID;
  if (!groupJid) {
    console.log("Set EXAMPLE_GROUP_JID=...@g.us to run the group-admin part.");
    console.log("Listening for calls. Ctrl-C to stop.");
    return;
  }

  const info = await client.getGroupInfo(groupJid);
  console.log(`Group: ${info?.name} (${info?.participantCount} members)`);
  console.log(`  announce-only : ${info?.announce ? "on" : "off"}`);
  console.log(`  info locked   : ${info?.restrict ? "on" : "off"}`);

  // Read the current value before toggling, so the example can put it back.
  // Every setter below needs you to be an admin of the group.
  const wasAnnounce = Boolean(info?.announce);
  await client.setGroupAnnounceOnly(groupJid, !wasAnnounce);
  console.log(`\nannounce-only → ${!wasAnnounce}`);
  await client.setGroupAnnounceOnly(groupJid, wasAnnounce);
  console.log(`announce-only → ${wasAnnounce} (restored)`);

  // Disappearing messages. EphemeralDuration.Off is 0, and miaw-core maps that
  // to "off" for you on this path — Baileys itself does not.
  await client.setGroupEphemeral(groupJid, EphemeralDuration.TwentyFourHours);
  await client.setGroupEphemeral(groupJid, EphemeralDuration.Off);
  console.log("ephemeral timer set to 24h, then disabled");

  // ── Join requests ─────────────────────────────────────────────────────────
  //
  // Requests only accumulate while join approval is ON. Turn it off and the
  // queue stops filling — a listing that returns [] usually means approval is
  // off, not that nobody wants in.
  await client.setGroupJoinApproval(groupJid, true);

  const pending = await client.getGroupJoinRequests(groupJid);
  console.log(`\nPending join requests: ${pending.length}`);
  for (const request of pending) {
    const when = request.requestedAt
      ? new Date(request.requestedAt * 1000).toISOString()
      : "unknown time";
    console.log(`  - ${request.jid} (${when})`);
  }

  if (pending.length > 0) {
    // Both take an array, and both accept bare phone numbers as well as JIDs.
    // The result is one entry per participant, so a partial failure is
    // visible rather than collapsed into a single boolean.
    const results = await client.approveGroupJoinRequests(
      groupJid,
      pending.map((r) => r.jid)
    );
    for (const r of results) {
      // `status` is WhatsApp's code as a string: '200' ok, '403' not admin,
      // '408' user is gone, '409' already a member. Worth surfacing — a
      // partial failure is common and a bare boolean hides which one failed.
      console.log(`  approve ${r.jid}: ${r.success ? "ok" : `failed (${r.status})`}`);
    }
    // client.rejectGroupJoinRequests(groupJid, [...]) is the same shape.
  }

  // Communities expose exactly the same surface under setCommunity* /
  // getCommunityJoinRequests / approveCommunityJoinRequests — same arguments,
  // same result shapes.

  console.log("\nListening for calls. Ctrl-C to stop.");
});

client.on("error", (error) => console.error("❌", error.message));

await client.connect();
