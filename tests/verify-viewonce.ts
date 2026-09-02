/**
 * Android identity + view-once receipt verification.
 *
 * Pairs a SPARE instance using BrowserPresets.android(), then waits for a
 * view-once image and confirms miaw-core both flags it and can download it.
 *
 * The primary session is untouched — this links an additional device on the
 * same WhatsApp account, which is what the Android identity requires.
 *
 *   npm run test:viewonce        (or: npx tsx tests/verify-viewonce.ts)
 */
import { MiawClient, BrowserPresets } from "../src/index.js";
import qrcode from "qrcode-terminal";
import * as fs from "node:fs";
import * as dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.test" });

const INSTANCE = "android-viewonce";
// Honour TEST_SESSION_PATH like every other test entry point does; this used
// to be hardcoded, so pointing the suite at a different session directory
// silently left this script on the old one.
const SESSION = process.env.TEST_SESSION_PATH || "./test-sessions";

const client = new MiawClient({
  instanceId: INSTANCE,
  sessionPath: SESSION,
  browser: BrowserPresets.android("13"),
  // Must stay ON. WhatsApp closes the socket with `restartRequired` (515)
  // immediately after a fresh QR pairing and expects the client to reconnect
  // on the credentials it just issued. With autoReconnect off, that normal
  // handshake step looks like a failure even though pairing succeeded.
  autoReconnect: true,
});

const sessionDir = `${SESSION}/${INSTANCE}`;
if (fs.existsSync(`${sessionDir}/creds.json`)) {
  console.log(`📂 Reusing the existing ${INSTANCE} session (no QR needed).`);
  console.log(`   Delete ${sessionDir} to force a fresh pairing.\n`);
}

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

  client.on("disconnected", (reason, statusCode) => {
    // 515 right after pairing is the expected post-QR restart, not a failure —
    // the credentials are already valid and autoReconnect will come straight
    // back. Anything else that is not a logout is also worth riding out.
    if (reason === "restartRequired" || statusCode === 515) {
      console.log("\n🔄 restartRequired (515) — expected after pairing, reconnecting...");
      return;
    }
    if (reason === "loggedOut") {
      console.log(`\n❌ logged out (${statusCode}) — pairing rejected`);
      resolve(false);
      return;
    }
    if (reason === "intentional") return;
    console.log(`\n… disconnected: reason=${reason} status=${statusCode} (waiting for reconnect)`);
  });

  client.on("reconnecting", (attempt) => console.log(`   reconnect attempt ${attempt}...`));

  setTimeout(() => resolve(false), 240000);
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
const WAIT_MS = Number(process.env.VIEWONCE_TIMEOUT_MS || 0);
console.log(
  WAIT_MS > 0
    ? `Waiting up to ${Math.round(WAIT_MS / 60000)} minutes...\n`
    : "Waiting indefinitely — press Ctrl+C when you are done.\n"
);

const got = await new Promise<any>((resolve) => {
  const onMsg = (m: any) => {
    // Log every inbound message, not just view-once ones: seeing an ordinary
    // image arrive proves the socket is live and narrows the problem to
    // view-once delivery specifically.
    console.log(
      `  [${new Date().toLocaleTimeString()}] message: type=${m.type} ` +
        `fromMe=${m.fromMe} viewOnce=${m.media?.viewOnce ?? "n/a"} from=${m.senderPhone ?? m.from}`
    );
    if (!m.fromMe && m.media?.viewOnce) {
      client.off("message", onMsg);
      resolve(m);
    }
  };
  client.on("message", onMsg);
  if (WAIT_MS > 0) setTimeout(() => resolve(null), WAIT_MS);
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
