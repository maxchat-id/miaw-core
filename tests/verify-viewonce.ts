/**
 * Android identity + view-once receipt verification.
 *
 * Pairs a SPARE instance using BrowserPresets.android(), then waits for a
 * view-once image and confirms miaw-core both flags it and can download it.
 *
 * The primary session is untouched — this links an additional device on the
 * same WhatsApp account, which is what the Android identity requires.
 *
 *   npx tsx tests/verify-viewonce.ts
 */
import { MiawClient, BrowserPresets } from "../src/index.js";
import qrcode from "qrcode-terminal";
import * as fs from "node:fs";

const INSTANCE = "android-viewonce";
const SESSION = "./test-sessions";

const client = new MiawClient({
  instanceId: INSTANCE,
  sessionPath: SESSION,
  browser: BrowserPresets.android("13"),
  autoReconnect: false,
});

console.log("browser identity:", JSON.stringify(BrowserPresets.android("13")));
console.log("(os slot = Android version, browser slot = 'Android' — the slot the handshake sniffs)\n");

client.on("qr", (qr) => {
  console.log("\n📱 Scan this with the SAME WhatsApp account");
  console.log("   (Settings → Linked Devices → Link a Device)\n");
  qrcode.generate(qr, { small: true });
  console.log("\nWaiting for scan...");
});

const ready = new Promise<boolean>((resolve) => {
  client.on("ready", () => resolve(true));
  client.on("disconnected", (r, s) => {
    console.log(`\n❌ disconnected: reason=${r} status=${s}`);
    resolve(false);
  });
  setTimeout(() => resolve(false), 180000);
});

await client.connect();
if (!await ready) {
  console.log("\n=== FAILED TO PAIR ===");
  process.exit(1);
}

console.log("\n✅ Paired with the Android identity.");
console.log("   Baileys should have logged an 'experimental' warning above.\n");
console.log("📸 Now send a VIEW-ONCE IMAGE to this account from another phone.");
console.log("   (attach an image → tap the ⓵ 'view once' icon → send)\n");
console.log("Waiting up to 3 minutes...\n");

const got = await new Promise<any>((resolve) => {
  const onMsg = (m: any) => {
    console.log(
      `  message: type=${m.type} fromMe=${m.fromMe} viewOnce=${m.media?.viewOnce ?? "n/a"}`
    );
    if (!m.fromMe && m.media?.viewOnce) {
      client.off("message", onMsg);
      resolve(m);
    }
  };
  client.on("message", onMsg);
  setTimeout(() => resolve(null), 180000);
});

if (!got) {
  console.log("\n=== NO VIEW-ONCE MESSAGE RECEIVED ===");
  console.log("The identity paired, but receipt is unconfirmed.");
  await client.disconnect();
  process.exit(2);
}

console.log("\n✅ VIEW-ONCE MESSAGE RECEIVED");
console.log("   type:", got.type);
console.log("   media.viewOnce:", got.media?.viewOnce);
console.log("   mimetype:", got.media?.mimetype);
console.log("   fileSize:", got.media?.fileSize);

const buf = await client.downloadMedia(got);
if (buf && buf.length > 0) {
  const out = `/tmp/viewonce-${Date.now()}.jpg`;
  fs.writeFileSync(out, buf);
  console.log(`\n✅ downloadMedia(): ${buf.length} bytes -> ${out}`);
  console.log("\n=== VIEW-ONCE RECEIPT CONFIRMED ===");
} else {
  console.log("\n❌ downloadMedia() returned nothing");
  await client.disconnect();
  process.exit(3);
}

await client.disconnect();
setTimeout(() => process.exit(0), 800);
