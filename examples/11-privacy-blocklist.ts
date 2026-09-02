/**
 * Privacy & Blocklist Example (v1.12.0)
 *
 * Demonstrates:
 * - Reading every privacy setting, including the ones miaw-core has no typed
 *   field for
 * - All eight privacy setters, and the two that cannot be read back
 * - Blocking, unblocking, listing the blocklist and checking one contact
 *
 * ⚠️ These change ACCOUNT-WIDE settings on a real WhatsApp account, and they
 * outlive the process. Everything below reads the current value first and
 * writes the same value back, so running this example changes nothing. If you
 * adapt it, keep that habit or you will quietly alter your own privacy.
 *
 * Run: npx tsx examples/11-privacy-blocklist.ts
 */

import { MiawClient } from "miaw-core";
import qrcode from "qrcode-terminal";

const client = new MiawClient({
  instanceId: "privacy-bot",
  sessionPath: "./sessions",
});

client.on("qr", (qr) => qrcode.generate(qr, { small: true }));

client.on("ready", async () => {
  console.log("✅ Connected\n");

  // ── Reading ───────────────────────────────────────────────────────────────
  const settings = await client.getPrivacySettings();
  if (!settings) {
    console.log("❌ Could not read privacy settings");
    return;
  }

  console.log("Typed fields (the 8 categories with setters):");
  console.log("  last seen      :", settings.lastSeen ?? "(not reported)");
  console.log("  online         :", settings.online ?? "(not reported)");
  console.log("  profile picture:", settings.profilePicture ?? "(not reported)");
  console.log("  status         :", settings.status ?? "(not reported)");
  console.log("  read receipts  :", settings.readReceipts ?? "(not reported)");
  console.log("  group add      :", settings.groupAdd ?? "(not reported)");
  console.log("  messages       :", settings.messages ?? "(not reported)");
  console.log("  calls          :", settings.calls ?? "(not reported)");

  // This is the part worth knowing about. WhatsApp returns more categories
  // than Baileys has setters for -- around sixteen at the time of writing,
  // including channelview, cover_photo, stickers and groupcreation. Rather
  // than drop what it cannot type, miaw-core keeps the whole response here.
  // If you need a category with no typed field, read it from `raw`.
  console.log("\nEverything WhatsApp actually returned:");
  for (const [key, value] of Object.entries(settings.raw)) {
    const typed = [
      "last", "online", "profile", "status",
      "readreceipts", "groupadd", "messages", "calladd",
    ].includes(key);
    console.log(`  ${key.padEnd(28)} ${String(value).padEnd(20)} ${typed ? "" : "← no typed field"}`);
  }

  // ── Writing ───────────────────────────────────────────────────────────────
  // Write each value back unchanged: exercises the setter, changes nothing.
  console.log("\nRound-tripping each setting (no net change):");

  if (settings.lastSeen) {
    const r = await client.setLastSeenPrivacy(settings.lastSeen);
    console.log("  setLastSeenPrivacy    :", r.success, r.error ?? "");
  }
  if (settings.online) {
    const r = await client.setOnlinePrivacy(settings.online);
    console.log("  setOnlinePrivacy      :", r.success, r.error ?? "");
  }
  if (settings.profilePicture) {
    const r = await client.setProfilePicturePrivacy(settings.profilePicture);
    console.log("  setProfilePicturePrivacy:", r.success, r.error ?? "");
  }
  if (settings.status) {
    const r = await client.setStatusPrivacy(settings.status);
    console.log("  setStatusPrivacy      :", r.success, r.error ?? "");
  }
  if (settings.readReceipts) {
    const r = await client.setReadReceiptsPrivacy(settings.readReceipts);
    console.log("  setReadReceiptsPrivacy:", r.success, r.error ?? "");
  }
  if (settings.groupAdd) {
    const r = await client.setGroupAddPrivacy(settings.groupAdd);
    console.log("  setGroupAddPrivacy    :", r.success, r.error ?? "");
  }
  if (settings.messages) {
    const r = await client.setMessagesPrivacy(settings.messages);
    console.log("  setMessagesPrivacy    :", r.success, r.error ?? "");
  }
  if (settings.calls) {
    const r = await client.setCallPrivacy(settings.calls);
    console.log("  setCallPrivacy        :", r.success, r.error ?? "");
  }

  // Two more setters exist, deliberately NOT called here:
  //
  //   client.setDefaultDisappearingMode(EphemeralDuration.TwentyFourHours)
  //   client.setLinkPreviewsDisabled(true)
  //
  // WhatsApp does not report either back through getPrivacySettings(), so
  // there is no current value to restore -- calling them would leave your
  // account somewhere it did not start. Uncomment only if you mean it.
  //
  // Note also that setDefaultDisappearingMode only affects NEW chats; use
  // setChatEphemeral() / setGroupEphemeral() for existing ones.

  // ── Blocklist ─────────────────────────────────────────────────────────────
  const blocked = await client.getBlocklist();
  console.log(`\nBlocklist: ${blocked.length} contact(s)`);
  for (const jid of blocked.slice(0, 5)) console.log("  -", jid);

  // isBlocked() takes a phone number or a JID, like every contact-taking method.
  const someone = "6281234567890";
  console.log(`\nIs ${someone} blocked?`, await client.isBlocked(someone));

  // Blocking is visible to the other party and is not silent -- they stop
  // being able to see your presence and cannot message you. Left commented
  // so that running this example cannot surprise a real contact.
  //
  // const blockResult = await client.blockContact(someone);
  // const unblockResult = await client.unblockContact(someone);

  console.log("\nDone. Nothing was changed.");
  await client.disconnect();
});

client.on("error", (error) => console.error("❌", error.message));

await client.connect();
