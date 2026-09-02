#!/usr/bin/env node
/**
 * Interactive Manual Testing Script for miaw-core
 *
 * This script guides you through testing each feature one by one.
 * Run it from the miaw-core directory after building:
 *
 *   npm run test:manual [group]
 *
 * Arguments:
 *   (none)      - Show available test groups and help
 *   all         - Run all tests interactively
 *   <group>     - Run one group; see CATEGORY_MAP below for the current list,
 *                 which `npm run test:manual` prints with a count per group.
 *                 Deliberately not enumerated here: this comment fell three
 *                 groups behind the code before anyone noticed.
 *
 * Environment variables (from .env / .env.test):
 *   DEBUG=true            - Enable verbose Baileys logging
 *   AUTO=1                - Unattended mode (same as --auto)
 *   AUTO_DESTRUCTIVE=1    - Also run destructive entries (same as --destructive)
 */

import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import qrcode from "qrcode-terminal";
import { MiawClient, EphemeralDuration } from "../src";
import type {
  PrivacyValue,
  PrivacyOnlineValue,
  PrivacyGroupAddValue,
  ReadReceiptsValue,
  PrivacyCallValue,
  PrivacyMessagesValue,
} from "../src";

/**
 * CLI argument -> the test categories it selects, plus the one-line description
 * shown by `showHelp()`.
 *
 * This is the single source of truth for the group list. The help output is
 * generated from it, so adding a group here is enough — the two used to be
 * hand-synced, which is how `privacy` and `calls` shipped in v1.12.0 without
 * ever appearing in the file's own header.
 */
const CATEGORY_MAP: {
  [key: string]: { categories: string[]; description: string };
} = {
  core: {
    categories: ["Core Client"],
    description: "Core Client (connect, disconnect, state)",
  },
  get: {
    categories: ["Basic GET Ops"],
    description: "Basic GET Operations (profile, contacts, chats)",
  },
  messaging: {
    categories: ["Messaging"],
    description: "Messaging (send, react, forward, edit, delete, pin)",
  },
  contacts: {
    categories: ["Contacts"],
    description: "Contacts (check, info, add, remove)",
  },
  group: {
    categories: ["Group Mgmt"],
    description: "Group Management (create, update, participants, admin)",
  },
  community: {
    categories: ["Community Mgmt"],
    description: "Communities (info, linked groups, admin, join requests)",
  },
  profile: {
    categories: ["Profile Mgmt"],
    description: "Profile Management (update name, status, picture)",
  },
  business: {
    categories: ["Business"],
    description: "Business [BIZ] (labels + catalog)",
  },
  newsletter: {
    categories: ["Newsletter"],
    description: "Newsletter (create, metadata, follow)",
  },
  ux: {
    categories: ["UX Features"],
    description: "UX Features (typing, presence, read receipts)",
  },
  privacy: {
    categories: ["Privacy & Blocklist"],
    description: "Privacy & Blocklist (settings, block/unblock)",
  },
  calls: {
    categories: ["Calls"],
    description: "Calls (call event, reject, call links)",
  },
};

// Get CLI argument
const rawArgs = process.argv.slice(2).map((a) => a.toLowerCase());
const cliArg = rawArgs.find((a) => !a.startsWith("--")) || "";

/**
 * Unattended mode: never block on stdin, never prompt, exit non-zero on failure.
 *
 * Enabled with `--auto` or AUTO=1. Every prompt resolves to "" — which the
 * existing helpers already treat as "use the cached .env.test value" — so the
 * same entries run, just without a human at the keyboard.
 *
 * Skipped in this mode:
 *   - `manual` entries, which need a human to send a message or place a call
 *   - `destructive` entries, unless AUTO_DESTRUCTIVE=1 (or --destructive)
 */
const AUTO_MODE = rawArgs.includes("--auto") || process.env.AUTO === "1";
const AUTO_DESTRUCTIVE =
  rawArgs.includes("--destructive") || process.env.AUTO_DESTRUCTIVE === "1";

// Load environment variables from .env and .env.test files
dotenv.config(); // Load .env first
dotenv.config({ path: ".env.test" }); // Then load .env.test (won't override existing)

// Debug mode from environment (default: false for cleaner output)
const DEBUG_MODE = process.env.DEBUG === "true";

// Suppress console output from libsignal/Baileys internals when not in debug mode
if (!DEBUG_MODE) {
  const originalConsoleLog = console.log;
  const originalConsoleDebug = console.debug;
  const originalConsoleWarn = console.warn;
  const originalConsoleInfo = console.info;

  // Filter out noisy internal logs (SessionEntry, signal protocol, etc.)
  const noisyStringPatterns = [
    /^Closing session/,
    /^SessionEntry/,
    /^_chains:/,
    /registrationId:/,
    /currentRatchet:/,
    /ephemeralKeyPair:/,
    /lastRemoteEphemeralKey:/,
    /previousCounter:/,
    /rootKey:/,
    /indexInfo:/,
    /baseKey:/,
    /baseKeyType:/,
    /remoteIdentityKey:/,
    /<Buffer/,
    /pendingPreKey:/,
    /signedKeyId:/,
    /preKeyId:/,
    /chainKey:/,
    /chainType:/,
    /messageKeys:/,
  ];

  // Check if an object looks like a SessionEntry or signal protocol internal
  const isNoisyObject = (obj: unknown): boolean => {
    if (typeof obj !== "object" || obj === null) return false;
    // SessionEntry objects
    if ("_chains" in obj || "registrationId" in obj || "currentRatchet" in obj)
      return true;
    if ("pendingPreKey" in obj || "indexInfo" in obj) return true;
    // Check constructor name
    if (obj.constructor?.name === "SessionEntry") return true;
    return false;
  };

  // Helper to check if any argument is noisy
  const hasNoisyArg = (args: unknown[]): boolean => {
    for (const arg of args) {
      // Check string arguments
      if (typeof arg === "string") {
        if (noisyStringPatterns.some((pattern) => pattern.test(arg))) {
          return true;
        }
      }
      // Check object arguments
      if (isNoisyObject(arg)) {
        return true;
      }
    }
    return false;
  };

  console.log = (...args: unknown[]) => {
    if (hasNoisyArg(args)) return;
    originalConsoleLog.apply(console, args);
  };

  console.warn = (...args: unknown[]) => {
    if (hasNoisyArg(args)) return;
    originalConsoleWarn.apply(console, args);
  };

  console.info = (...args: unknown[]) => {
    if (hasNoisyArg(args)) return;
    originalConsoleInfo.apply(console, args);
  };

  console.debug = (...args: unknown[]) => {
    // Suppress all debug logs when not in debug mode
    if (!DEBUG_MODE) return;
    originalConsoleDebug.apply(console, args);
  };
}

// Test configuration - load defaults from .env.test
const TEST_CONFIG = {
  instanceId: process.env.TEST_INSTANCE_ID || "manual-test-bot",
  sessionPath: process.env.TEST_SESSION_PATH || "./test-sessions-manual",
  // Pre-load from .env.test, user can override during testing
  testPhone: process.env.TEST_CONTACT_PHONE_A || "",
  testPhone2: process.env.TEST_CONTACT_PHONE_B || "",
  testGroupJid: process.env.TEST_GROUP_JID || "",
  // Detected account type
  isBusiness: false,
  accountPhone: "",
  // Last created label (for addChatLabel test)
  lastCreatedLabelId: "",
  // Last labeled chat JID (for removeChatLabel test)
  lastLabeledChatJid: "",
  // Last created product (for catalog tests)
  lastCreatedProductId: "",
  // Last created newsletter (for newsletter tests)
  lastCreatedNewsletterId: "",
  // Track if user explicitly chose to disconnect
  shouldDisconnect: false,
  // Track if using existing session (skip setup tests)
  useExistingSession: false,
  // Track last reacted message for removeReaction test
  lastReactedMessage: null as any,
};

// Test results tracking
const testResults: { [key: string]: "pass" | "fail" | "skip" } = {};

// Test interface with optional businessOnly flag
interface TestItem {
  category: string;
  name: string;
  test?: (client: MiawClient) => boolean | string | Promise<boolean | string>;
  action?: (client: MiawClient) => boolean | string | Promise<boolean | string>;
  businessOnly?: boolean; // Skip for personal accounts
  /**
   * Needs a human to DO something out-of-band — send a message to the bot,
   * place a call. Env config cannot substitute for it, so AUTO mode skips these.
   */
  manual?: boolean;
  /**
   * Irreversibly changes real state (leaves a group, deletes a product). AUTO
   * mode skips these unless AUTO_DESTRUCTIVE=1.
   */
  destructive?: boolean;
}

// All tests organized by category
const tests: TestItem[] = [
  // ============================================================
  // PREREQUISITES
  // ============================================================
  {
    category: "Prerequisites",
    name: "Test Bot Setup",
    action: async () => {
      console.log("\n📱 ACTION REQUIRED:");
      console.log("1. Make sure you have a test WhatsApp account ready");
      console.log("2. I will now connect and show you a QR code");
      console.log("3. Scan the QR code with your WhatsApp");
      console.log("\nPress ENTER when ready to connect...");
      await waitForEnter();
      return true;
    },
  },

  // ============================================================
  // CORE CLIENT
  // ============================================================
  {
    category: "Core Client",
    name: "Constructor - Create client",
    test: () => {
      try {
        const client = new MiawClient({
          instanceId: TEST_CONFIG.instanceId,
          sessionPath: TEST_CONFIG.sessionPath,
          debug: DEBUG_MODE,
        });
        return client !== null;
      } catch (e) {
        console.error("Error:", e);
        return false;
      }
    },
  },
  {
    category: "Core Client",
    name: "connect() - Connect to WhatsApp",
    action: async (client: MiawClient) => {
      // Check if already connected
      if (client.isConnected()) {
        console.log("✅ Already connected! Skipping QR code scan.");
        // Detect account type
        await detectAccountType(client);
        return true;
      }

      console.log("\n📱 Connecting to WhatsApp...");
      console.log("----------------------------------------");

      // Start connection first
      client.connect();

      // Wait for either QR code or ready event (whichever comes first)
      const result = await new Promise<"qr" | "ready" | "timeout">(
        (resolve) => {
          const timeout = setTimeout(() => resolve("timeout"), 120000);

          client.once("qr", (qr: string) => {
            clearTimeout(timeout);
            console.log("\n📱 Scan the QR code below with WhatsApp:");
            qrcode.generate(qr, { small: true });
            resolve("qr");
          });

          client.once("ready", () => {
            clearTimeout(timeout);
            resolve("ready");
          });
        }
      );

      if (result === "ready") {
        console.log("✅ Connected successfully using existing session!");
        // Detect account type
        await detectAccountType(client);
        return true;
      }

      if (result === "timeout") {
        console.log("❌ Timeout waiting for connection");
        return false;
      }

      // QR was shown, now wait for ready
      console.log("\n✅ QR code displayed. Scan it now.");
      console.log("Waiting for connection...");

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 120000);
        client.once("ready", () => {
          clearTimeout(timeout);
          console.log("✅ Connected successfully!");
          resolve();
        });
      });

      // Detect account type after connection
      await detectAccountType(client);

      return true;
    },
  },
  {
    category: "Core Client",
    name: "getConnectionState() - Get connection state",
    test: (client: MiawClient) => {
      const state = client.getConnectionState();
      console.log("Current state:", state);
      return state === "connected";
    },
  },
  {
    category: "Core Client",
    name: "getInstanceId() - Get instance ID",
    test: (client: MiawClient) => {
      const id = client.getInstanceId();
      console.log("Instance ID:", id);
      return id === TEST_CONFIG.instanceId;
    },
  },
  {
    category: "Core Client",
    name: "isConnected() - Check if connected",
    test: (client: MiawClient) => {
      const connected = client.isConnected();
      console.log("Is connected:", connected);
      return connected === true;
    },
  },

  // ============================================================
  // BASIC GET OPERATIONS (v0.9.0)
  // ============================================================
  {
    category: "Basic GET Ops",
    name: "getOwnProfile() - Get your profile",
    test: async (client: MiawClient) => {
      const profile = await client.getOwnProfile();
      if (!profile) {
        console.log("❌ Failed to get profile");
        return false;
      }
      console.log("Your Profile:");
      console.log("  JID:", profile.jid);
      console.log("  Phone:", profile.phone || "(not available)");
      console.log("  Name:", profile.name || "(not set)");
      console.log("  Status:", profile.status || "(not set)");
      console.log("  Is Business:", profile.isBusiness || false);
      return true;
    },
  },
  {
    category: "Basic GET Ops",
    name: "fetchAllContacts() - Get all contacts",
    test: async (client: MiawClient) => {
      const result = await client.fetchAllContacts();
      console.log("Success:", result.success);
      console.log("Total contacts:", result.contacts?.length || 0);
      if (result.contacts && result.contacts.length > 0) {
        console.log("Sample contact:", {
          jid: result.contacts[0].jid,
          name: result.contacts[0].name || "(no name)",
        });
      }
      console.log(
        "\n⚠️  If 0 contacts, history sync may not have completed yet."
      );
      return result.success;
    },
  },
  {
    category: "Basic GET Ops",
    name: "fetchAllGroups() - Get all groups",
    test: async (client: MiawClient) => {
      const result = await client.fetchAllGroups();
      console.log("Success:", result.success);
      console.log("Total groups:", result.groups?.length || 0);
      if (result.groups && result.groups.length > 0) {
        console.log("Sample group:", {
          jid: result.groups[0].jid,
          name: result.groups[0].name,
          participants: result.groups[0].participantCount,
        });
      }
      return result.success;
    },
  },
  {
    category: "Basic GET Ops",
    name: "fetchAllChats() - Get all chats",
    test: async (client: MiawClient) => {
      const result = await client.fetchAllChats();
      console.log("Success:", result.success);
      console.log("Total chats:", result.chats?.length || 0);
      if (result.chats && result.chats.length > 0) {
        console.log("Sample chat:", {
          jid: result.chats[0].jid,
          name: result.chats[0].name || "(no name)",
          isGroup: result.chats[0].isGroup,
        });
      }
      console.log("\n⚠️  If 0 chats, history sync may not have completed yet.");
      return result.success;
    },
  },
  {
    category: "Basic GET Ops",
    name: "getChatMessages(jid) - Get chat messages",
    action: async (client: MiawClient) => {
      console.log(
        "\n📱 Enter a phone number or group JID to fetch messages from:"
      );
      console.log("  - Phone: 6281234567890");
      console.log("  - Group: 123456789@g.us");
      console.log("  - Or press ENTER to use status@whatsapp.net");
      const jid = await waitForInput();

      const targetJid = jid.trim() || "status@whatsapp.net";
      const result = await client.getChatMessages(targetJid);

      console.log("Success:", result.success);
      console.log("Total messages:", result.messages?.length || 0);
      if (result.messages && result.messages.length > 0) {
        console.log("Sample message:", {
          id: result.messages[0].id,
          type: result.messages[0].type,
          from: result.messages[0].from,
          text: result.messages[0].text || "(no text)",
        });
      }

      return result.success;
    },
  },

  // ============================================================
  // MESSAGING
  // ============================================================
  {
    category: "Messaging",
    name: "sendText() - Send text message",
    action: async (client: MiawClient) => {
      const phone = await getTestPhone(
        "Enter phone number to send test message:"
      );
      const text = `Test message from miaw-core manual test - ${new Date().toISOString()}`;

      console.log(`\n📤 Sending text to ${phone}...`);
      const result = await client.sendText(phone, text);

      console.log("Success:", result.success);
      console.log("Message ID:", result.messageId || "(none)");

      if (!result.success) {
        console.log("Error:", result.error);
      }

      return result.success;
    },
  },
  {
    category: "Messaging",
    name: "replyToMessage() - Reply/quote a message",
    manual: true,
    action: async (client: MiawClient) => {
      console.log("\n💬 To test replying to a message:");
      console.log("1. Send a message to the bot from another phone");
      console.log("2. I will reply to it with a quoted message");

      const message = await waitForMessage(
        client,
        (msg) => msg.type === "text",
        30000
      );
      console.log(
        `\n💬 Replying to message: "${message.text?.substring(0, 30)}..."`
      );

      const replyText = `This is a reply to your message! 📝\nOriginal: "${message.text?.substring(
        0,
        50
      )}..."`;

      // Use sendText with quoted option to reply
      const result = await client.sendText(message.chatJid, replyText, {
        quoted: message,
      });

      console.log("Success:", result.success);
      console.log("Message ID:", result.messageId || "(none)");

      if (!result.success) {
        console.log("Error:", result.error);
      }

      return result.success;
    },
  },
  {
    category: "Messaging",
    name: "sendImage() - Send image",
    action: async (client: MiawClient) => {
      console.log("\n📤 Sending an image requires a test image file.");
      console.log("Path: tests/test-assets/test-image.jpg");
      console.log("\nPress ENTER if you have the test image, or skip (s)");

      const answer = await waitForInput();
      if (answer.toLowerCase() === "s") return "skip";

      const phone = await getTestPhone("Enter phone number to send image:");
      const imagePath = "./tests/test-assets/test-image.jpg";

      // Check if file exists
      if (!fs.existsSync(imagePath)) {
        console.log(`⚠️  Test image not found at ${imagePath}`);
        console.log("Create a test image at that path to test this feature.");
        return "skip";
      }

      const result = await client.sendImage(phone, imagePath, {
        caption: "Test image from miaw-core",
      });

      console.log("Success:", result.success);
      console.log("Message ID:", result.messageId || "(none)");

      return result.success;
    },
  },
  {
    category: "Messaging",
    name: "sendDocument() - Send document",
    action: async () => {
      console.log("\n📤 Sending a document requires a test file.");
      console.log("Skipping for now - test with sendImage() pattern");
      return "skip";
    },
  },
  {
    category: "Messaging",
    name: "sendVideo() - Send video",
    action: async () => {
      console.log("\n📤 Sending video requires a test video file.");
      console.log("Skipping for now - test with sendImage() pattern");
      return "skip";
    },
  },
  {
    category: "Messaging",
    name: "sendAudio() - Send audio",
    action: async () => {
      console.log("\n📤 Sending audio requires a test audio file.");
      console.log("Skipping for now - test with sendImage() pattern");
      return "skip";
    },
  },
  {
    category: "Messaging",
    name: "downloadMedia() - Download media",
    manual: true,
    action: async (client: MiawClient) => {
      console.log("\n📥 To test media download:");
      console.log("1. Send an image/video to the bot from another phone");
      console.log("2. I will listen for the message and download it");

      const message = await waitForMessage(
        client,
        (msg) => msg.type === "image" || msg.type === "video",
        30000
      );

      console.log(`\n📥 Downloading media from ${message.type} message...`);
      const buffer = await client.downloadMedia(message);

      if (buffer) {
        console.log("✅ Media downloaded successfully");
        console.log(`Buffer size: ${buffer.length} bytes`);
        return true;
      } else {
        console.log("❌ Failed to download media");
        return false;
      }
    },
  },

  // --- Message Operations ---
  {
    category: "Messaging",
    name: "sendReaction() - Send reaction",
    manual: true,
    action: async (client: MiawClient) => {
      console.log("\n📝 To test reactions:");
      console.log("1. Send a message to the bot from another phone");
      console.log("2. I will react to it with 👍");

      const message = await waitForMessage(
        client,
        (msg) => msg.type === "text",
        30000
      );
      console.log(
        `\n📝 Reacting to message ${message.id.substring(0, 10)}... with 👍`
      );

      const result = await client.sendReaction(message, "👍");
      console.log("Success:", result.success);

      // Store for removeReaction test
      if (result.success) {
        TEST_CONFIG.lastReactedMessage = message;
      }

      return result.success;
    },
  },
  {
    category: "Messaging",
    name: "removeReaction() - Remove reaction",
    manual: true,
    action: async (client: MiawClient) => {
      if (!TEST_CONFIG.lastReactedMessage) {
        console.log("\n⚠️  No previous reaction to remove.");
        console.log("   Run sendReaction() test first.");
        return "skip";
      }

      console.log("\n📝 Removing reaction from previous message...");
      const result = await client.sendReaction(
        TEST_CONFIG.lastReactedMessage,
        "" // Empty string removes reaction
      );
      console.log("Success:", result.success);

      // Clear the tracked message
      if (result.success) {
        TEST_CONFIG.lastReactedMessage = null;
      }

      return result.success;
    },
  },
  {
    category: "Messaging",
    name: "forwardMessage() - Forward message",
    manual: true,
    action: async (client: MiawClient) => {
      const phone2 = await getTestPhone2(
        "Enter phone number to forward message to:"
      );
      console.log("\n📝 To test forwarding:");
      console.log("1. Send a message to the bot from another phone");
      console.log(`2. I will forward it to ${phone2}`);

      const message = await waitForMessage(
        client,
        (msg) => msg.type === "text",
        30000
      );
      console.log(`\n📤 Forwarding message to ${phone2}...`);

      const result = await client.forwardMessage(message, phone2);
      console.log("Success:", result.success);
      return result.success;
    },
  },
  {
    category: "Messaging",
    name: "editMessage() - Edit message",
    action: async (client: MiawClient) => {
      const phone = await getTestPhone(
        "Enter phone number to send and edit message:"
      );

      console.log("\n✏️  Sending a message to edit...");
      const originalText = `Original message - ${Date.now()}`;
      const sendResult = await client.sendText(phone, originalText);

      if (!sendResult.success || !sendResult.messageId) {
        console.log("❌ Failed to send message for editing");
        return false;
      }

      console.log("✅ Message sent:", sendResult.messageId);
      console.log("⏳ Waiting 2 seconds before editing...");
      await new Promise((resolve) => setTimeout(resolve, 2000));

      console.log("✏️  Editing message...");
      const editedText = `✏️ EDITED: ${originalText}`;

      // Create a MiawMessage-like object with raw.key for Baileys
      const chatJid = phone.includes("@") ? phone : `${phone}@s.whatsapp.net`;
      const messageToEdit = {
        id: sendResult.messageId,
        chatJid: chatJid,
        fromMe: true,
        raw: {
          key: {
            remoteJid: chatJid,
            fromMe: true,
            id: sendResult.messageId,
          },
        },
      };

      const result = await client.editMessage(messageToEdit as any, editedText);
      console.log("Success:", result.success);
      if (!result.success) {
        console.log("Error:", result.error || "(none)");
      }
      return result.success;
    },
  },
  {
    category: "Messaging",
    name: "deleteMessage() - Delete for everyone",
    manual: true,
    action: async (client: MiawClient) => {
      const phone = await getTestPhone(
        "Enter phone number to send and delete message:"
      );

      console.log("\n🗑️  Sending a message to delete...");
      const sendResult = await client.sendText(
        phone,
        `This message will be deleted - ${Date.now()}`
      );

      if (!sendResult.success || !sendResult.messageId) {
        console.log("❌ Failed to send message for deletion");
        return false;
      }

      console.log("✅ Message sent:", sendResult.messageId);
      console.log("⏳ Waiting 2 seconds before deleting...");
      await new Promise((resolve) => setTimeout(resolve, 2000));

      console.log("🗑️  Deleting message for everyone...");

      // Create a MiawMessage-like object with raw.key for Baileys
      const chatJid = phone.includes("@") ? phone : `${phone}@s.whatsapp.net`;
      const messageToDelete = {
        id: sendResult.messageId,
        chatJid: chatJid,
        fromMe: true,
        raw: {
          key: {
            remoteJid: chatJid,
            fromMe: true,
            id: sendResult.messageId,
          },
        },
      };

      const result = await client.deleteMessage(messageToDelete as any);
      console.log("Success:", result.success);
      return result.success;
    },
  },

  // ============================================================
  // CONTACTS
  // ============================================================
  {
    category: "Contacts",
    name: "checkNumber() - Check if number on WhatsApp",
    action: async (client: MiawClient) => {
      const phone = await getTestPhone("Enter phone number to check:");
      console.log(`\n🔍 Checking if ${phone} is on WhatsApp...`);

      const result = await client.checkNumber(phone);
      console.log("Exists:", result.exists);
      console.log("JID:", result.jid || "(none)");

      return result.exists !== undefined;
    },
  },
  {
    category: "Contacts",
    name: "checkNumbers() - Batch check numbers",
    action: async (client: MiawClient) => {
      const phone1 = await getTestPhone("Enter first phone number:");
      const phone2 = await getTestPhone2("Enter second phone number:");

      console.log(`\n🔍 Checking multiple numbers...`);
      const results = await client.checkNumbers([phone1, phone2]);

      console.log("Results:");
      results.forEach((r, i) => {
        console.log(
          `  ${i + 1}. Exists: ${r.exists}, JID: ${r.jid || "(none)"}`
        );
      });

      return results.length === 2;
    },
  },
  {
    category: "Contacts",
    name: "getContactInfo() - Get contact info",
    action: async (client: MiawClient) => {
      const phone = await getTestPhone("Enter phone number to get info:");
      console.log(`\n👤 Getting contact info for ${phone}...`);

      const info = await client.getContactInfo(phone);
      if (!info) {
        console.log("❌ No info found");
        return false;
      }

      console.log("Contact Info:");
      console.log("  JID:", info.jid);
      console.log("  Name:", info.name || "(not available)");
      console.log("  Phone:", info.phone || "(not available)");
      console.log("  Status:", info.status || "(not available)");

      return true;
    },
  },
  {
    category: "Contacts",
    name: "getBusinessProfile() - Get business profile",
    action: async (client: MiawClient) => {
      const phone = await getTestPhone(
        "Enter business phone number (or press ENTER to skip):"
      );
      if (!phone) return "skip";

      console.log(`\n💼 Getting business profile for ${phone}...`);

      const profile = await client.getBusinessProfile(phone);
      if (!profile) {
        console.log("ℹ️  Not a business account (or not found)");
        return true; // This is expected for non-business
      }

      console.log("Business Profile:");
      console.log("  Description:", profile.description || "(none)");
      console.log("  Category:", profile.category || "(none)");
      console.log("  Website:", profile.website || "(none)");

      return true;
    },
  },
  {
    category: "Contacts",
    name: "getProfilePicture() - Get profile picture",
    action: async (client: MiawClient) => {
      const phone = await getTestPhone(
        "Enter phone number to get profile picture:"
      );
      console.log(`\n📷 Getting profile picture for ${phone}...`);

      const url = await client.getProfilePicture(phone);
      if (!url) {
        console.log("ℹ️  No profile picture (privacy settings or no picture)");
        return true;
      }

      console.log("Profile Picture URL:", url.substring(0, 80) + "...");
      return true;
    },
  },

  // ============================================================
  // GROUP MANAGEMENT
  // Flow: Create → Info → Update → Participants → Invite → Destructive
  // ============================================================

  // --- Group Creation ---
  {
    category: "Group Mgmt",
    name: "createGroup() - Create new group",
    action: async (client: MiawClient) => {
      const phone1 = await getTestPhone(
        "Enter first participant phone number:"
      );
      const phone2 = await getTestPhone2(
        "Enter second participant phone number:"
      );

      console.log("\n👥 Creating new group...");
      const groupName = `Test Group ${Date.now()}`;

      const result = await client.createGroup(groupName, [phone1, phone2]);

      console.log("Success:", result.success);
      if (result.success) {
        console.log("Group JID:", result.groupJid);
        TEST_CONFIG.testGroupJid = result.groupJid || "";
        console.log("Saved as test group for subsequent tests");
      } else {
        console.log("Error:", result.error);
      }

      return result.success;
    },
  },

  // --- Group Info (verify creation) ---
  {
    category: "Group Mgmt",
    name: "getGroupInfo() - Get group metadata",
    action: async (client: MiawClient) => {
      const groupJid = await getTestGroup(
        "Enter group JID (e.g., 123456789@g.us):"
      );
      console.log(`\n👥 Getting group info for ${groupJid}...`);

      const info = await client.getGroupInfo(groupJid);
      if (!info) {
        console.log("❌ Failed to get group info");
        return false;
      }

      console.log("Group Info:");
      console.log("  JID:", info.jid);
      console.log("  Name:", info.name);
      console.log("  Participants:", info.participantCount);
      console.log("  Description:", info.description || "(none)");

      return true;
    },
  },
  {
    category: "Group Mgmt",
    name: "getGroupParticipants() - Get group members",
    action: async (client: MiawClient) => {
      const groupJid = await getTestGroup("Enter group JID:");
      console.log(`\n👥 Getting group participants for ${groupJid}...`);

      const participants = await client.getGroupParticipants(groupJid);
      if (!participants) {
        console.log("❌ Failed to get participants");
        return false;
      }

      console.log(`Total participants: ${participants.length}`);
      const admins = participants.filter((p) => p.role !== "member");
      console.log(`Admins: ${admins.length}`);

      return true;
    },
  },

  // --- Group Updates ---
  {
    category: "Group Mgmt",
    name: "updateGroupName() - Change group name",
    action: async (client: MiawClient) => {
      const groupJid = await getTestGroup("Enter group JID:");
      const newName = `Updated Group ${Date.now()}`;

      console.log(`\n✏️  Updating group name to: ${newName}`);
      const result = await client.updateGroupName(groupJid, newName);

      console.log("Success:", result.success);
      if (!result.success) {
        console.log("Error:", result.error);
      }

      return result.success;
    },
  },
  {
    category: "Group Mgmt",
    name: "updateGroupDescription() - Set group description",
    action: async (client: MiawClient) => {
      const groupJid = await getTestGroup("Enter group JID:");
      const desc = `Test description updated at ${new Date().toISOString()}`;

      console.log(`\n📝 Updating group description...`);
      const result = await client.updateGroupDescription(groupJid, desc);

      console.log("Success:", result.success);
      if (!result.success) {
        console.log("Error:", result.error);
      }

      return result.success;
    },
  },
  {
    category: "Group Mgmt",
    name: "updateGroupPicture() - Change group picture",
    action: async () => {
      console.log("\n📷 Updating group picture requires a test image file.");
      console.log("Skipping for now - test with sendImage() pattern");
      return "skip";
    },
  },

  // --- Participant Management ---
  {
    category: "Group Mgmt",
    name: "addParticipants() - Add members to group",
    action: async (client: MiawClient) => {
      const groupJid = await getTestGroup("Enter group JID:");
      const phone = await getOtherPartyPhone("Enter phone number to add:");

      console.log(`\n👤 Adding ${phone} to group...`);
      const results = await client.addParticipants(groupJid, [phone]);

      // Print the status code. WhatsApp's per-participant codes are the whole
      // story here and a bare pass/fail hides it: '409' means the number is
      // already a member, which is the normal state on a reused test group and
      // is not a failure of addParticipants().
      for (const r of results) {
        console.log(`  ${r.success ? "✅" : "❌"} ${r.jid} status=${r.status}`);
      }
      const successCount = results.filter((r) => r.success).length;
      console.log(`Success: ${successCount}/${results.length}`);

      if (successCount === 0 && results.every((r) => r.status === "409")) {
        console.log(
          "\n⏭️  Already a participant (409) — nothing to add. Remove them from"
        );
        console.log("   the group first if you want to exercise the add path.");
        return "skipped";
      }

      return successCount > 0;
    },
  },
  {
    category: "Group Mgmt",
    name: "promoteToAdmin() - Promote member to admin",
    action: async (client: MiawClient) => {
      const groupJid = await getTestGroup("Enter group JID:");
      const phone = await getOtherPartyPhone("Enter phone number to promote:");

      console.log(`\n⬆️  Promoting ${phone} to admin...`);
      console.log("⚠️  You must be admin to do this");
      const results = await client.promoteToAdmin(groupJid, [phone]);

      console.log("Results:", results.length);
      const successCount = results.filter((r) => r.success).length;
      console.log(`Success: ${successCount}/${results.length}`);

      return successCount > 0;
    },
  },
  {
    category: "Group Mgmt",
    name: "demoteFromAdmin() - Demote admin",
    action: async (client: MiawClient) => {
      const groupJid = await getTestGroup("Enter group JID:");
      const phone = await getOtherPartyPhone("Enter admin phone number to demote:");

      console.log(`\n⬇️  Demoting ${phone} from admin...`);
      console.log("⚠️  You must be admin to do this");
      const results = await client.demoteFromAdmin(groupJid, [phone]);

      console.log("Results:", results.length);
      const successCount = results.filter((r) => r.success).length;
      console.log(`Success: ${successCount}/${results.length}`);

      return successCount > 0;
    },
  },

  // --- Invite Operations ---
  {
    category: "Group Mgmt",
    name: "getGroupInviteLink() - Get invite link",
    action: async (client: MiawClient) => {
      const groupJid = await getTestGroup("Enter group JID:");

      console.log(`\n🔗 Getting group invite link...`);
      const result = await client.getGroupInviteLink(groupJid);

      if (result) {
        console.log("✅ Invite link:", result);
        return true;
      } else {
        console.log("❌ Failed to get invite link");
        return false;
      }
    },
  },
  {
    category: "Group Mgmt",
    name: "acceptGroupInvite() - Join via invite",
    action: async (client: MiawClient) => {
      console.log("\n🔗 To test joining via invite:");
      console.log("1. Get an invite link from a group");
      console.log("2. Paste the invite code or full URL");

      const invite = await waitForInput();
      if (!invite) return "skip";

      console.log(`\n🔗 Accepting invite...`);
      const groupJid = await client.acceptGroupInvite(invite);

      if (groupJid) {
        console.log("Joined group:", groupJid);
        return true;
      } else {
        console.log("Failed to join group");
        return false;
      }
    },
  },

  // --- Destructive Operations (at the end) ---
  {
    category: "Group Mgmt",
    name: "removeParticipants() - Remove members (DESTRUCTIVE)",
    destructive: true,
    action: async (client: MiawClient) => {
      const groupJid = await getTestGroup("Enter group JID:");
      const phone = await getOtherPartyPhone("Enter phone number to remove:");

      console.log(`\n👤 Removing ${phone} from group...`);
      console.log("⚠️  You must be admin to do this");
      const results = await client.removeParticipants(groupJid, [phone]);

      console.log("Results:", results.length);
      const successCount = results.filter((r) => r.success).length;
      console.log(`Success: ${successCount}/${results.length}`);

      return successCount > 0;
    },
  },
  {
    category: "Group Mgmt",
    name: "leaveGroup() - Leave group (DESTRUCTIVE)",
    destructive: true,
    action: async (client: MiawClient) => {
      console.log("\n⚠️  This will make the bot leave a group.");
      console.log("Press ENTER to continue, or s to skip");
      const answer = await waitForInput();
      if (answer.toLowerCase() === "s") return "skip";

      const groupJid = await getTestGroup("Enter group JID to leave:");
      console.log(`\n🚪 Leaving group ${groupJid}...`);

      const result = await client.leaveGroup(groupJid);
      console.log("Success:", result.success);

      return result.success;
    },
  },

  // ============================================================
  // PROFILE MANAGEMENT (4 methods)
  // ============================================================
  {
    category: "Profile Mgmt",
    name: "updateProfilePicture() - Update own profile picture",
    action: async () => {
      console.log("\n📷 Updating profile picture requires a test image file.");
      console.log("Skipping for now - requires test image");
      return "skip";
    },
  },
  {
    category: "Profile Mgmt",
    name: "updateProfileName() - Update display name",
    action: async (client: MiawClient) => {
      console.log("\n✏️  Updating your profile name...");
      const newName = `Test Bot ${Date.now()}`;

      const result = await client.updateProfileName(newName);

      console.log("Success:", result.success);
      console.log("New name:", newName);

      return result.success;
    },
  },
  {
    category: "Profile Mgmt",
    name: "updateProfileStatus() - Update About text",
    action: async (client: MiawClient) => {
      console.log("\n✏️  Updating your status/About text...");
      const newStatus = `Miaw Core Test Bot - ${new Date().toISOString()}`;

      const result = await client.updateProfileStatus(newStatus);

      console.log("Success:", result.success);
      console.log("New status:", newStatus);

      return result.success;
    },
  },
  // --- Destructive profile operations (at the end) ---
  {
    category: "Profile Mgmt",
    name: "removeProfilePicture() - Remove profile picture (DESTRUCTIVE)",
    destructive: true,
    action: async (client: MiawClient) => {
      console.log("\n🗑️  This will remove your profile picture.");
      console.log("Press ENTER to continue, or s to skip");
      const answer = await waitForInput();
      if (answer.toLowerCase() === "s") return "skip";

      console.log("\n🗑️  Removing profile picture...");
      const result = await client.removeProfilePicture();

      console.log("Success:", result.success);
      return result.success;
    },
  },

  // ============================================================
  // BUSINESS FEATURES - WhatsApp Business only
  // ============================================================

  // --- Labels ---
  {
    category: "Business",
    name: "fetchAllLabels() - Get all labels",
    businessOnly: true,
    action: async (client: MiawClient) => {
      console.log("\n🏷️  Fetching all labels...");

      // Force sync to get fresh labels from WhatsApp
      const result = await client.fetchAllLabels(true);

      console.log("Success:", result.success);
      console.log("Total labels:", result.labels?.length || 0);

      if (result.labels && result.labels.length > 0) {
        console.log("Sample labels:");
        result.labels.slice(0, 3).forEach((l, i) => {
          console.log(`  ${i + 1}. ${l.name} (${l.color})`);
        });
      }

      return result.success;
    },
  },
  {
    category: "Business",
    name: "addLabel() - Create new label",
    businessOnly: true,
    action: async (client: MiawClient) => {
      console.log("\n🏷️  Creating a new label...");

      const result = await client.addLabel({
        name: `Test Label ${Date.now()}`,
        color: 1, // LabelColor.Color2
      });

      console.log("Success:", result.success);
      if (result.success) {
        console.log("Label ID:", result.labelId);
        // Store for use in addChatLabel test
        TEST_CONFIG.lastCreatedLabelId = result.labelId || "";
      } else {
        console.log("Error:", result.error);
      }

      return result.success;
    },
  },
  {
    category: "Business",
    name: "addChatLabel() - Add label to chat",
    businessOnly: true,
    action: async (client: MiawClient) => {
      if (!TEST_CONFIG.lastCreatedLabelId) {
        console.log("\n🏷️  No label created yet. Run addLabel() first.");
        return "skip";
      }

      const phone = await getTestPhone("Enter phone number to add label to:");
      console.log(
        `\n🏷️  Adding label ${TEST_CONFIG.lastCreatedLabelId} to chat ${phone}...`
      );

      const result = await client.addChatLabel(
        phone,
        TEST_CONFIG.lastCreatedLabelId
      );

      console.log("Success:", result.success);
      if (result.success) {
        // Store the chat JID for removeChatLabel test
        TEST_CONFIG.lastLabeledChatJid = phone.includes("@")
          ? phone
          : `${phone}@s.whatsapp.net`;
      } else {
        console.log("Error:", result.error);
      }

      return result.success;
    },
  },
  {
    category: "Business",
    name: "removeChatLabel() - Remove label from chat",
    businessOnly: true,
    action: async (client: MiawClient) => {
      if (!TEST_CONFIG.lastCreatedLabelId || !TEST_CONFIG.lastLabeledChatJid) {
        console.log("\n⚠️  No label or chat to remove label from.");
        console.log("   Run addChatLabel() test first.");
        return "skip";
      }

      console.log(
        `\n🏷️  Removing label ${TEST_CONFIG.lastCreatedLabelId} from chat ${TEST_CONFIG.lastLabeledChatJid}...`
      );

      const result = await client.removeChatLabel(
        TEST_CONFIG.lastLabeledChatJid,
        TEST_CONFIG.lastCreatedLabelId
      );

      console.log("Success:", result.success);
      if (result.success) {
        // Clear tracked values after successful removal
        TEST_CONFIG.lastLabeledChatJid = "";
      } else {
        console.log("Error:", result.error);
      }

      return result.success;
    },
  },
  {
    category: "Business",
    name: "addMessageLabel() - Add label to message",
    businessOnly: true,
    action: async () => {
      console.log("\n🏷️  Skipping add message label test...");
      return "skip";
    },
  },

  // --- Catalog ---
  {
    category: "Business",
    name: "createProduct() - Add new product",
    businessOnly: true,
    action: async (client: MiawClient) => {
      console.log("\n🛠️  Creating a test product...");
      console.log("📷 This requires a test image file.");
      console.log("Path: tests/test-assets/test-image.jpg");
      console.log("\nPress ENTER if you have the test image, or skip (s)");

      const answer = await waitForInput();
      if (answer.toLowerCase() === "s") return "skip";

      const imagePath = "./tests/test-assets/test-image.jpg";

      // Check if file exists
      if (!fs.existsSync(imagePath)) {
        console.log(`⚠️  Test image not found at ${imagePath}`);
        console.log("Create a test image at that path to test this feature.");
        return "skip";
      }

      // Read image as buffer
      const imageBuffer = fs.readFileSync(imagePath);

      const productName = `Test Product ${Date.now()}`;
      const result = await client.createProduct({
        name: productName,
        description: "Test product created by miaw-core interactive test",
        price: 10000, // Price in smallest unit (e.g., cents)
        currency: "IDR",
        imageBuffers: [imageBuffer],
      });

      console.log("Success:", result.success);
      if (result.success) {
        console.log("Product ID:", result.productId);
        // Store for subsequent tests
        TEST_CONFIG.lastCreatedProductId = result.productId || "";
      } else {
        console.log("Error:", result.error);
        console.log(
          "💡 Tip: Catalog requires WhatsApp Business with catalog enabled"
        );
      }

      return result.success;
    },
  },
  {
    category: "Business",
    name: "getCatalog() - Fetch product catalog",
    businessOnly: true,
    action: async (client: MiawClient) => {
      console.log("\n🛒 Fetching product catalog...");

      const result = await client.getCatalog();

      console.log("Success:", result.success);
      if (result.success) {
        console.log("Total products:", result.products?.length || 0);
        if (result.products && result.products.length > 0) {
          console.log("Products:");
          result.products.slice(0, 5).forEach((p, i) => {
            console.log(
              `  ${i + 1}. [${p.id}] ${p.name || "Unnamed"} - ${p.price} ${
                p.currency || ""
              }`
            );
          });

          // Always try to recover/set a product ID for subsequent tests
          if (!TEST_CONFIG.lastCreatedProductId) {
            // First, try to find a test product we created earlier
            const testProduct = result.products.find((p) =>
              p.name?.startsWith("Test Product")
            );
            if (testProduct?.id) {
              TEST_CONFIG.lastCreatedProductId = testProduct.id;
              console.log(`📌 Recovered test product ID: ${testProduct.id}`);
            } else if (result.products[0]?.id) {
              // If no test product, use the first product for update/delete tests
              TEST_CONFIG.lastCreatedProductId = result.products[0].id;
              console.log(
                `📌 Using existing product for tests: ${result.products[0].id}`
              );
              console.log(
                `   (${result.products[0].name || "Unnamed"} - ${
                  result.products[0].price
                } ${result.products[0].currency || ""})`
              );
            }
          }
        }
      } else {
        console.log("Error:", result.error);
        console.log(
          "💡 Tip: Run createProduct() first to add products to catalog"
        );
      }

      return result.success;
    },
  },
  {
    category: "Business",
    name: "getCollections() - Get catalog collections",
    businessOnly: true,
    action: async (client: MiawClient) => {
      console.log("\n📁 Fetching catalog collections...");
      console.log("(This may take a moment...)");

      try {
        const result = await client.getCollections();

        console.log("Total collections:", result.length);
        if (result.length > 0) {
          console.log("Collections:");
          result.slice(0, 5).forEach((c, i) => {
            console.log(`  ${i + 1}. ${c.name} (${c.id})`);
            if (c.products && c.products.length > 0) {
              console.log(`     Products: ${c.products.length}`);
            }
          });
        } else {
          console.log("⚠️  No collections found via API.");
          console.log(
            "    Note: Collections created in WhatsApp Business app may not"
          );
          console.log(
            "    appear via the Baileys API. This is a known WhatsApp limitation."
          );
        }
      } catch (error) {
        console.log("Error fetching collections:", error);
      }

      return true; // Collections may be empty, that's OK
    },
  },
  {
    category: "Business",
    name: "updateProduct() - Modify product",
    businessOnly: true,
    action: async (client: MiawClient) => {
      if (!TEST_CONFIG.lastCreatedProductId) {
        console.log(
          "\n⚠️  No product ID tracked. Run getCatalog() first to auto-detect."
        );
        return "skip";
      }

      console.log(
        `\n✏️  Updating product ${TEST_CONFIG.lastCreatedProductId}...`
      );

      const result = await client.updateProduct(
        TEST_CONFIG.lastCreatedProductId,
        {
          name: `Updated Test Product ${Date.now()}`,
          description: "Updated description by miaw-core test",
          price: 15000,
          currency: "IDR",
        }
      );

      console.log("Success:", result.success);
      if (!result.success) {
        console.log("Error:", result.error);
      }

      return result.success;
    },
  },
  {
    category: "Business",
    name: "deleteProducts() - Remove products (CLEANUP)",
    destructive: true,
    businessOnly: true,
    action: async (client: MiawClient) => {
      if (!TEST_CONFIG.lastCreatedProductId) {
        console.log(
          "\n⚠️  No product ID tracked. Run getCatalog() first to auto-detect."
        );
        return "skip";
      }

      console.log(
        `\n🗑️  Deleting test product ${TEST_CONFIG.lastCreatedProductId}...`
      );
      console.log("⚠️  This will permanently delete the test product!");

      const answer = await waitForInput(
        "Type 'yes' to confirm deletion, or press ENTER to skip: "
      );
      if (answer.toLowerCase() !== "yes") {
        console.log("Skipped deletion.");
        return "skip";
      }

      const result = await client.deleteProducts([
        TEST_CONFIG.lastCreatedProductId,
      ]);

      console.log("Success:", result.success);
      if (result.success) {
        console.log("Deleted count:", result.deletedCount);
        TEST_CONFIG.lastCreatedProductId = ""; // Clear after deletion
      } else {
        console.log("Error:", result.error);
      }

      return result.success;
    },
  },

  // ============================================================
  // NEWSLETTER/CHANNEL OPERATIONS (subset)
  // ============================================================
  {
    category: "Newsletter",
    name: "createNewsletter() - Create newsletter/channel",
    action: async (client: MiawClient) => {
      console.log("\n📰 Creating a new newsletter/channel...");
      console.log("⚠️  This creates a new channel on your account");
      console.log("Press ENTER to continue, or s to skip");

      const answer = await waitForInput();
      if (answer.toLowerCase() === "s") return "skip";

      const channelName = `Test Channel ${Date.now()}`;
      console.log(`\n📝 Creating channel: "${channelName}"...`);

      const result = await client.createNewsletter(
        channelName,
        "Test channel for miaw-core manual testing"
      );

      console.log("\n📊 Result:");
      console.log("  Success:", result.success);
      if (result.success) {
        if (result.newsletterId) {
          console.log("  Newsletter ID:", result.newsletterId);
          // Store for subsequent tests
          TEST_CONFIG.lastCreatedNewsletterId = result.newsletterId;
        } else {
          console.log(
            "  ⚠️ Newsletter ID not returned (may need to check your channels)"
          );
        }
      } else {
        console.log("  Error:", result.error);
      }

      return result.success;
    },
  },
  {
    category: "Newsletter",
    name: "getNewsletterMetadata() - Get newsletter info",
    action: async (client: MiawClient) => {
      // Use stored newsletter ID or prompt for one
      let newsletterId = TEST_CONFIG.lastCreatedNewsletterId;

      if (newsletterId) {
        console.log(`\n📰 Using created newsletter: ${newsletterId}`);
      } else {
        console.log("\n📰 Enter newsletter ID (e.g., 123456789@newsletter):");
        console.log("Press ENTER to skip");
        newsletterId = await waitForInput();
        if (!newsletterId) return "skip";
      }

      console.log(`\n🔍 Fetching metadata for ${newsletterId}...`);
      const meta = await client.getNewsletterMetadata(newsletterId);

      if (meta) {
        console.log("\n📊 Newsletter Info:");
        console.log("  ID:", meta.id);
        console.log("  Name:", meta.name);
        console.log("  Description:", meta.description || "(none)");
        console.log("  Subscribers:", meta.subscribers || 0);
        console.log(
          "  Created:",
          meta.createdAt
            ? new Date(meta.createdAt * 1000).toLocaleString()
            : "unknown"
        );
        return true;
      } else {
        console.log("❌ Failed to get newsletter metadata");
        return false;
      }
    },
  },
  {
    category: "Newsletter",
    name: "sendNewsletterMessage() - Send text to channel",
    action: async (client: MiawClient) => {
      // Use stored newsletter ID or prompt for one
      let newsletterId = TEST_CONFIG.lastCreatedNewsletterId;

      if (newsletterId) {
        console.log(`\n📰 Send to created newsletter: ${newsletterId}`);
      } else {
        console.log(
          "\n📰 Enter newsletter ID to send message (e.g., 123456789@newsletter):"
        );
        console.log("Press ENTER to skip");
        newsletterId = await waitForInput();
        if (!newsletterId) return "skip";
      }

      console.log(`\n📝 Sending text message to ${newsletterId}...`);
      const result = await client.sendNewsletterMessage(
        newsletterId,
        `Test newsletter message from miaw-core at ${new Date().toISOString()}`
      );

      console.log("\n📊 Result:");
      console.log("  Success:", result.success);
      if (result.success) {
        console.log("  Message ID:", result.messageId);
      } else {
        console.log("  Error:", result.error);
      }
      return result.success;
    },
  },
  {
    category: "Newsletter",
    name: "sendNewsletterImage() - Send image to channel",
    action: async (client: MiawClient) => {
      // Use stored newsletter ID or prompt for one
      let newsletterId = TEST_CONFIG.lastCreatedNewsletterId;

      if (newsletterId) {
        console.log(`\n📰 Send image to created newsletter: ${newsletterId}`);
      } else {
        console.log(
          "\n📰 Enter newsletter ID to send image (e.g., 123456789@newsletter):"
        );
        console.log("Press ENTER to skip");
        newsletterId = await waitForInput();
        if (!newsletterId) return "skip";
      }

      console.log(`\n🖼️  Sending image to ${newsletterId}...`);
      const result = await client.sendNewsletterImage(
        newsletterId,
        "https://placehold.co/400x300/png",
        "Test image from miaw-core newsletter test"
      );

      console.log("\n📊 Result:");
      console.log("  Success:", result.success);
      if (result.success) {
        console.log("  Message ID:", result.messageId);
      } else {
        console.log("  Error:", result.error);
      }
      return result.success;
    },
  },
  {
    category: "Newsletter",
    name: "followNewsletter() - Follow/subscribe",
    action: async (client: MiawClient) => {
      console.log(
        "\n📰 Enter newsletter ID to follow (or press ENTER to skip):"
      );
      const newsletterId = await waitForInput();
      if (!newsletterId) return "skip";

      console.log(`\n👆 Following ${newsletterId}...`);
      const success = await client.followNewsletter(newsletterId);
      console.log(success ? "✅ Followed successfully" : "❌ Failed to follow");
      return success;
    },
  },
  {
    category: "Newsletter",
    name: "deleteNewsletter() - Delete newsletter",
    destructive: true,
    action: async (client: MiawClient) => {
      // Use stored newsletter ID or prompt
      let newsletterId = TEST_CONFIG.lastCreatedNewsletterId;

      if (newsletterId) {
        console.log(`\n📰 Delete the test channel: ${newsletterId}?`);
        console.log("Press ENTER to delete, or 's' to skip");
        const confirm = await waitForInput();
        if (confirm.toLowerCase() === "s") return "skip";
      } else {
        console.log("\n📰 Enter newsletter ID to delete:");
        console.log("Press ENTER to skip");
        newsletterId = await waitForInput();
        if (!newsletterId) return "skip";
      }

      console.log(`\n🗑️  Deleting ${newsletterId}...`);
      const success = await client.deleteNewsletter(newsletterId);

      if (success) {
        console.log("✅ Deleted successfully");
        TEST_CONFIG.lastCreatedNewsletterId = "";
      } else {
        console.log("❌ Failed to delete");
      }
      return success;
    },
  },

  // --- Contact Management ---
  {
    category: "Contacts",
    name: "addOrEditContact() - Add or update contact",
    action: async (client: MiawClient) => {
      const phone = await getTestPhone(
        "Enter phone number to save as contact:"
      );
      console.log("\n👤 Enter contact name:");
      const name = await waitForInput();

      console.log(`\n💾 Saving contact: ${name} (${phone})...`);
      const result = await client.addOrEditContact({
        phone: phone,
        name: name,
      });

      console.log("Success:", result.success);
      return result.success;
    },
  },
  {
    category: "Contacts",
    name: "removeContact() - Remove contact",
    destructive: true,
    action: async (client: MiawClient) => {
      const phone = await getTestPhone(
        "Enter phone number to remove from contacts:"
      );

      console.log(`\n🗑️  Removing contact ${phone}...`);
      const result = await client.removeContact(phone);

      console.log("Success:", result.success);
      return result.success;
    },
  },

  // ============================================================
  // UX FEATURES (5 methods)
  // ============================================================
  {
    category: "UX Features",
    name: "markAsRead() - Mark message as read",
    manual: true,
    action: async (client: MiawClient) => {
      console.log("\n📝 To test mark as read:");
      console.log("1. Send a message to the bot from another phone");
      console.log("2. I will mark it as read");

      const message = await waitForMessage(
        client,
        (msg) => msg.type === "text",
        30000
      );
      console.log(`\n✅ Marking message as read...`);

      const result = await client.markAsRead(message);
      console.log("Success:", result);
      return result;
    },
  },
  {
    category: "UX Features",
    name: "sendTyping() - Send typing indicator",
    action: async (client: MiawClient) => {
      const phone = await getTestPhone("Enter phone number to send typing to:");

      console.log(`\n⌨️  Sending typing indicator to ${phone}...`);
      await client.sendTyping(phone);

      console.log("✅ Typing indicator sent");
      console.log('Check the other phone - you should see "typing..."');

      // Stop typing after 2 seconds
      setTimeout(async () => {
        await client.stopTyping(phone);
        console.log("✅ Stopped typing indicator");
      }, 2000);

      return true;
    },
  },
  {
    category: "UX Features",
    name: "sendRecording() - Send recording indicator",
    action: async (client: MiawClient) => {
      const phone = await getTestPhone(
        "Enter phone number to send recording to:"
      );

      console.log(`\n🎤 Sending recording indicator to ${phone}...`);
      await client.sendRecording(phone);

      console.log("✅ Recording indicator sent");
      console.log(
        'Check the other phone - you should see "recording audio..."'
      );

      // Stop recording after 2 seconds
      setTimeout(async () => {
        await client.stopTyping(phone);
        console.log("✅ Stopped recording indicator");
      }, 2000);

      return true;
    },
  },
  {
    category: "UX Features",
    name: "setPresence() - Set online/offline status",
    action: async (client: MiawClient) => {
      console.log("\n🌐 Setting presence to available (online)...");
      await client.setPresence("available");
      console.log("Set to available");

      console.log("\n🌙 Setting presence to unavailable (offline)...");
      await client.setPresence("unavailable");
      console.log("Set to unavailable");

      return true;
    },
  },
  {
    category: "UX Features",
    name: "subscribePresence() - Subscribe to presence updates",
    action: async (client: MiawClient) => {
      const phone = await getTestPhone(
        "Enter phone number to subscribe presence:"
      );

      console.log(`\n👁️  Subscribing to presence updates for ${phone}...`);
      await client.subscribePresence(phone);

      console.log("✅ Subscribed to presence updates");
      console.log("Send a message from that phone to trigger presence update");

      return true;
    },
  },

  // ============================================================
  // PRIVACY & BLOCKLIST (v1.12.0)
  // ============================================================
  {
    category: "Privacy & Blocklist",
    name: "getPrivacySettings() - Read current privacy settings",
    test: async (client: MiawClient) => {
      const settings = await client.getPrivacySettings();
      if (!settings) {
        console.log("❌ Failed to fetch privacy settings");
        return false;
      }
      console.log("Last seen:      ", settings.lastSeen ?? "(not set)");
      console.log("Online:         ", settings.online ?? "(not set)");
      console.log("Profile picture:", settings.profilePicture ?? "(not set)");
      console.log("Status:         ", settings.status ?? "(not set)");
      console.log("Read receipts:  ", settings.readReceipts ?? "(not set)");
      console.log("Group add:      ", settings.groupAdd ?? "(not set)");
      console.log("Messages:       ", settings.messages ?? "(not set)");
      console.log("Calls:          ", settings.calls ?? "(not set)");
      console.log("\nRaw:", JSON.stringify(settings.raw));
      return true;
    },
  },
  {
    category: "Privacy & Blocklist",
    name: "All 8 privacy setters - Round-trip each current value",
    action: async (client: MiawClient) => {
      // Read first and write the SAME value back for every setting, so a manual
      // run exercises all eight setters without changing the tester's own
      // privacy. Driven from one table rather than eight near-identical entries.
      const settings = await client.getPrivacySettings();
      if (!settings) {
        console.log("❌ Failed to fetch privacy settings");
        return false;
      }

      const roundTrips: Array<{
        label: string;
        current: string | undefined;
        apply: (value: string) => Promise<{ success: boolean; error?: string }>;
      }> = [
        {
          label: "last-seen",
          current: settings.lastSeen,
          apply: (v) => client.setLastSeenPrivacy(v as PrivacyValue),
        },
        {
          label: "online",
          current: settings.online,
          apply: (v) => client.setOnlinePrivacy(v as PrivacyOnlineValue),
        },
        {
          label: "picture",
          current: settings.profilePicture,
          apply: (v) => client.setProfilePicturePrivacy(v as PrivacyValue),
        },
        {
          label: "status",
          current: settings.status,
          apply: (v) => client.setStatusPrivacy(v as PrivacyValue),
        },
        {
          label: "read-receipts",
          current: settings.readReceipts,
          apply: (v) => client.setReadReceiptsPrivacy(v as ReadReceiptsValue),
        },
        {
          label: "group-add",
          current: settings.groupAdd,
          apply: (v) => client.setGroupAddPrivacy(v as PrivacyGroupAddValue),
        },
        {
          label: "messages",
          current: settings.messages,
          apply: (v) => client.setMessagesPrivacy(v as PrivacyMessagesValue),
        },
        {
          label: "calls",
          current: settings.calls,
          apply: (v) => client.setCallPrivacy(v as PrivacyCallValue),
        },
      ];

      let attempted = 0;
      const failures: string[] = [];
      for (const { label, current, apply } of roundTrips) {
        if (!current) {
          console.log(`  ⏭️  ${label.padEnd(14)} WhatsApp reported no value`);
          continue;
        }
        attempted++;
        const result = await apply(current);
        console.log(
          `  ${result.success ? "✅" : "❌"} ${label.padEnd(14)} "${current}" ${result.error || ""}`
        );
        if (!result.success) failures.push(label);
      }

      if (attempted === 0) {
        console.log("\n⏭️  WhatsApp reported no privacy values at all; skipping");
        return "skipped";
      }
      console.log(`\nRound-tripped ${attempted}/${roundTrips.length} settings.`);
      return failures.length === 0;
    },
  },
  {
    category: "Privacy & Blocklist",
    name: "setDefaultDisappearingMode() / setLinkPreviewsDisabled()",
    // Unlike the eight above, WhatsApp does not report these two back through
    // getPrivacySettings(), so there is no current value to restore. This entry
    // therefore leaves them at WhatsApp's DEFAULTS (disappearing off, link
    // previews on) rather than at whatever you had -- hence destructive.
    destructive: true,
    action: async (client: MiawClient) => {
      console.log(
        "\n⚠️  These two cannot be read back, so they will be left at WhatsApp's"
      );
      console.log("   defaults: disappearing OFF, link previews ON.\n");

      console.log("⏳ Default disappearing mode -> 24h...");
      const on = await client.setDefaultDisappearingMode(
        EphemeralDuration.TwentyFourHours
      );
      console.log("Success:", on.success, on.error || "");

      console.log("↩️  Default disappearing mode -> off...");
      const off = await client.setDefaultDisappearingMode(EphemeralDuration.Off);
      console.log("Success:", off.success, off.error || "");

      console.log("\n🔗 Link previews -> disabled...");
      const disabled = await client.setLinkPreviewsDisabled(true);
      console.log("Success:", disabled.success, disabled.error || "");

      console.log("↩️  Link previews -> enabled (default)...");
      const enabled = await client.setLinkPreviewsDisabled(false);
      console.log("Success:", enabled.success, enabled.error || "");

      return on.success && off.success && disabled.success && enabled.success;
    },
  },
  {
    category: "Privacy & Blocklist",
    name: "getBlocklist() - List blocked contacts",
    test: async (client: MiawClient) => {
      const blocked = await client.getBlocklist();
      console.log("Blocked contacts:", blocked.length);
      for (const jid of blocked.slice(0, 10)) {
        console.log("  -", jid);
      }
      return true;
    },
  },
  {
    category: "Privacy & Blocklist",
    name: "blockContact() / unblockContact() - Block then restore",
    action: async (client: MiawClient) => {
      const phone = await getOtherPartyPhone(
        "Enter a phone number to block and then immediately unblock:"
      );

      const before = await client.isBlocked(phone);
      if (before) {
        console.log("⏭️  Already blocked; skipping so we don't unblock it");
        return "skipped";
      }

      console.log(`\n🚫 Blocking ${phone}...`);
      const blockResult = await client.blockContact(phone);
      console.log("Block success:", blockResult.success, blockResult.error || "");
      if (!blockResult.success) return false;

      console.log("Now blocked?", await client.isBlocked(phone));

      console.log(`\n✅ Unblocking ${phone} to restore the original state...`);
      const unblockResult = await client.unblockContact(phone);
      console.log("Unblock success:", unblockResult.success, unblockResult.error || "");
      return unblockResult.success;
    },
  },

  // ============================================================
  // CALLS (v1.12.0)
  // ============================================================
  {
    category: "Calls",
    name: "call event - Receive an incoming call",
    manual: true,
    action: async (client: MiawClient) => {
      console.log("\n📞 Call the bot from another phone within 45 seconds.");
      console.log("   (Do not answer — we only need the 'offer' event.)");

      const call: any = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 45000);
        client.once("call", (c) => {
          clearTimeout(timer);
          resolve(c);
        });
      });

      if (!call) {
        console.log("⏭️  No call received within the timeout");
        return "skipped";
      }

      console.log("\n✅ Call event received:");
      console.log("  id:      ", call.id);
      console.log("  from:    ", call.from);
      console.log("  status:  ", call.status);
      console.log("  isVideo: ", call.isVideo);
      console.log("  isGroup: ", call.isGroup);
      console.log("  date:    ", call.date?.toISOString?.());
      return true;
    },
  },
  {
    category: "Calls",
    name: "rejectCall() - Reject an incoming call",
    manual: true,
    action: async (client: MiawClient) => {
      console.log("\n📞 Call the bot from another phone within 45 seconds.");
      console.log("   It should be rejected automatically.");

      const call: any = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 45000);
        const onCall = (c: any) => {
          if (c.status !== "offer") return;
          clearTimeout(timer);
          client.off("call", onCall);
          resolve(c);
        };
        client.on("call", onCall);
      });

      if (!call) {
        console.log("⏭️  No call offer received within the timeout");
        return "skipped";
      }

      console.log(`\n🚫 Rejecting call ${call.id} from ${call.from}...`);
      const result = await client.rejectCall(call.id, call.from);
      console.log("Success:", result.success, result.error || "");
      return result.success;
    },
  },
  {
    category: "Calls",
    name: "createCallLink() - Create a shareable video call link",
    destructive: true,
    action: async (client: MiawClient) => {
      console.log("\n⚠️  This mints a REAL shareable call link.");
      console.log("   [y] Create it   [n] Skip (default)");
      const answer = await waitForInput("> [y/n]: ");
      if (answer.toLowerCase() !== "y") {
        console.log("⏭️  Skipped");
        return "skipped";
      }

      const link = await client.createCallLink("video");
      if (!link) {
        console.log("❌ Failed to create call link");
        return false;
      }
      console.log("\n✅ Call link:", link);
      return true;
    },
  },

  // ============================================================
  // GROUP ADMIN (v1.12.0)
  // ============================================================
  {
    category: "Group Mgmt",
    name: "getGroupJoinRequests() - List pending join requests",
    test: async (client: MiawClient) => {
      const groupJid = await getTestGroup("Enter group JID:");
      const requests = await client.getGroupJoinRequests(groupJid);
      console.log("Pending join requests:", requests.length);
      for (const r of requests) {
        console.log(
          "  -",
          r.jid,
          r.requestedAt ? new Date(r.requestedAt * 1000).toISOString() : "(no timestamp)"
        );
      }
      console.log(
        "\n⚠️  Requests only accumulate while join approval is ON for the group."
      );
      return true;
    },
  },
  {
    category: "Group Mgmt",
    name: "setGroupJoinApproval() - Toggle join approval and restore",
    action: async (client: MiawClient) => {
      const groupJid = await getTestGroup("Enter group JID (you must be admin):");

      console.log("\n🔒 Turning join approval ON...");
      const on = await client.setGroupJoinApproval(groupJid, true);
      console.log("Success:", on.success, on.error || "");
      if (!on.success) return false;

      console.log("\n🔓 Turning it back OFF to restore the original state...");
      const off = await client.setGroupJoinApproval(groupJid, false);
      console.log("Success:", off.success, off.error || "");
      return off.success;
    },
  },
  {
    category: "Group Mgmt",
    name: "setGroupAnnounceOnly() - Toggle announce mode and restore",
    action: async (client: MiawClient) => {
      const groupJid = await getTestGroup("Enter group JID (you must be admin):");

      const info = await client.getGroupInfo(groupJid);
      const wasAnnounce = Boolean(info?.announce);
      console.log(`\nCurrent announce mode: ${wasAnnounce ? "ON" : "OFF"}`);

      console.log(`\n🔒 Setting announce mode to ${!wasAnnounce ? "ON" : "OFF"}...`);
      const toggled = await client.setGroupAnnounceOnly(groupJid, !wasAnnounce);
      console.log("Success:", toggled.success, toggled.error || "");
      if (!toggled.success) return false;

      console.log("\n↩️  Restoring the original setting...");
      const restored = await client.setGroupAnnounceOnly(groupJid, wasAnnounce);
      console.log("Success:", restored.success, restored.error || "");
      return restored.success;
    },
  },
  {
    category: "Group Mgmt",
    name: "setGroupEphemeral() - Set disappearing messages, then disable",
    action: async (client: MiawClient) => {
      const groupJid = await getTestGroup("Enter group JID (you must be admin):");

      console.log("\n⏳ Setting disappearing messages to 24 hours...");
      const on = await client.setGroupEphemeral(groupJid, 86400);
      console.log("Success:", on.success, on.error || "");
      if (!on.success) return false;

      console.log("\n↩️  Disabling it again...");
      const off = await client.setGroupEphemeral(groupJid, 0);
      console.log("Success:", off.success, off.error || "");
      return off.success;
    },
  },
  {
    category: "Group Mgmt",
    name: "setGroupRestrictInfo() - Toggle info-edit lock and restore",
    action: async (client: MiawClient) => {
      const groupJid = await getTestGroup("Enter group JID (you must be admin):");

      const info = await client.getGroupInfo(groupJid);
      const wasRestricted = Boolean(info?.restrict);
      console.log(`\nCurrent info-edit lock: ${wasRestricted ? "ON" : "OFF"}`);

      console.log(`\n🔒 Setting it to ${!wasRestricted ? "ON" : "OFF"}...`);
      const toggled = await client.setGroupRestrictInfo(groupJid, !wasRestricted);
      console.log("Success:", toggled.success, toggled.error || "");
      if (!toggled.success) return false;

      console.log("\n↩️  Restoring the original setting...");
      const restored = await client.setGroupRestrictInfo(groupJid, wasRestricted);
      console.log("Success:", restored.success, restored.error || "");
      return restored.success;
    },
  },
  {
    category: "Group Mgmt",
    name: "setGroupMemberAddMode() - Switch who may add members",
    // getGroupInfo() does not report the current add-mode, so this cannot
    // restore what you had -- it ends on WhatsApp's default, all_member_add.
    destructive: true,
    action: async (client: MiawClient) => {
      const groupJid = await getTestGroup("Enter group JID (you must be admin):");
      console.log(
        "\n⚠️  The current mode is not readable; this ends on 'all_member_add'.\n"
      );

      console.log("🔒 Restricting member-add to admins...");
      const admins = await client.setGroupMemberAddMode(groupJid, "admin_add");
      console.log("Success:", admins.success, admins.error || "");
      if (!admins.success) return false;

      console.log("\n↩️  Restoring the default (all members may add)...");
      const all = await client.setGroupMemberAddMode(groupJid, "all_member_add");
      console.log("Success:", all.success, all.error || "");
      return all.success;
    },
  },
  {
    category: "Group Mgmt",
    name: "approveGroupJoinRequests() / rejectGroupJoinRequests()",
    // Needs a real person to request to join while approval is ON.
    manual: true,
    action: async (client: MiawClient) => {
      const groupJid = await getTestGroup("Enter group JID (you must be admin):");

      const pending = await client.getGroupJoinRequests(groupJid);
      if (pending.length === 0) {
        console.log(
          "\n⏭️  No pending join requests. Turn join approval ON, have someone"
        );
        console.log("   request to join via the invite link, then re-run.");
        return "skipped";
      }

      console.log(`\nPending requests (${pending.length}):`);
      pending.forEach((r, i) => console.log(`  ${i + 1}. ${r.jid}`));

      const answer = await waitForInput(
        "\nApprove or reject the FIRST request? [a]pprove / [r]eject / [s]kip: "
      );
      const choice = answer.trim().toLowerCase();
      const target = pending[0].jid;

      if (choice === "a") {
        const result = await client.approveGroupJoinRequests(groupJid, [target]);
        console.log("Approve:", JSON.stringify(result));
        return result.every((r) => r.success);
      }
      if (choice === "r") {
        const result = await client.rejectGroupJoinRequests(groupJid, [target]);
        console.log("Reject:", JSON.stringify(result));
        return result.every((r) => r.success);
      }
      console.log("⏭️  Left the request pending.");
      return "skipped";
    },
  },

  // ============================================================
  // COMMUNITY MANAGEMENT (v1.9.0 + v1.12.0 admin)
  // ============================================================
  {
    category: "Community Mgmt",
    name: "getAllCommunities() - List communities you belong to",
    test: async (client: MiawClient) => {
      const communities = await client.getAllCommunities();
      console.log("Communities:", communities.length);
      for (const c of communities.slice(0, 10)) {
        console.log(`  - ${c.name} (${c.jid})`);
      }
      if (communities.length === 0) {
        console.log(
          "\n⚠️  No communities found. The rest of this group needs one to exist."
        );
      }
      return true;
    },
  },
  {
    category: "Community Mgmt",
    name: "getCommunityInfo() / getLinkedGroups()",
    test: async (client: MiawClient) => {
      const jid = await getTestGroup("Enter community JID:");
      const info = await client.getCommunityInfo(jid);
      if (!info) {
        // Almost always means the JID is an ordinary group rather than a
        // community, or the account belongs to none. That is an environment
        // limitation, not a defect — report it as skipped so it does not sit
        // permanently red, the same way the degenerate-config warning keeps
        // env problems from reading as code problems.
        console.log("⏭️  Not a community (or no community on this account); skipping");
        console.log("   Set the prompt/TEST_GROUP_JID to a community JID to run this.");
        return "skipped";
      }
      console.log("Name:", info.name);
      console.log("Participants:", info.participantCount);

      const linked = await client.getLinkedGroups(jid);
      console.log("Linked groups:", linked.length);
      for (const g of linked.slice(0, 10)) {
        console.log(`  - ${g.subject} (${g.id ?? "no id"})`);
      }
      return true;
    },
  },
  {
    category: "Community Mgmt",
    name: "getCommunityJoinRequests() - List pending join requests",
    test: async (client: MiawClient) => {
      const jid = await getTestGroup("Enter community JID:");
      const requests = await client.getCommunityJoinRequests(jid);
      console.log("Pending join requests:", requests.length);
      for (const r of requests) {
        console.log(
          "  -",
          r.jid,
          r.requestedAt ? new Date(r.requestedAt * 1000).toISOString() : "(no timestamp)"
        );
      }
      console.log(
        "\n⚠️  Requests only accumulate while join approval is ON."
      );
      return true;
    },
  },
  {
    category: "Community Mgmt",
    name: "setCommunityAnnounceOnly() - Toggle announce mode and restore",
    action: async (client: MiawClient) => {
      const jid = await getTestGroup("Enter community JID (you must be admin):");

      const info = await client.getCommunityInfo(jid);
      const wasAnnounce = Boolean(info?.announce);
      console.log(`\nCurrent announce mode: ${wasAnnounce ? "ON" : "OFF"}`);

      const toggled = await client.setCommunityAnnounceOnly(jid, !wasAnnounce);
      console.log("Toggle success:", toggled.success, toggled.error || "");
      if (!toggled.success) return false;

      const restored = await client.setCommunityAnnounceOnly(jid, wasAnnounce);
      console.log("Restore success:", restored.success, restored.error || "");
      return restored.success;
    },
  },
  {
    category: "Community Mgmt",
    name: "setCommunityRestrictInfo() - Toggle info-edit lock and restore",
    action: async (client: MiawClient) => {
      const jid = await getTestGroup("Enter community JID (you must be admin):");

      const info = await client.getCommunityInfo(jid);
      const wasRestricted = Boolean(info?.restrict);
      console.log(`\nCurrent info-edit lock: ${wasRestricted ? "ON" : "OFF"}`);

      const toggled = await client.setCommunityRestrictInfo(jid, !wasRestricted);
      console.log("Toggle success:", toggled.success, toggled.error || "");
      if (!toggled.success) return false;

      const restored = await client.setCommunityRestrictInfo(jid, wasRestricted);
      console.log("Restore success:", restored.success, restored.error || "");
      return restored.success;
    },
  },
  {
    category: "Community Mgmt",
    name: "setCommunityJoinApproval() - Toggle join approval and restore",
    action: async (client: MiawClient) => {
      const jid = await getTestGroup("Enter community JID (you must be admin):");

      console.log("\n🔒 Turning join approval ON...");
      const on = await client.setCommunityJoinApproval(jid, true);
      console.log("Success:", on.success, on.error || "");
      if (!on.success) return false;

      console.log("\n🔓 Turning it back OFF...");
      const off = await client.setCommunityJoinApproval(jid, false);
      console.log("Success:", off.success, off.error || "");
      return off.success;
    },
  },
  {
    category: "Community Mgmt",
    name: "setCommunityEphemeral() - Set disappearing messages, then disable",
    action: async (client: MiawClient) => {
      const jid = await getTestGroup("Enter community JID (you must be admin):");

      const on = await client.setCommunityEphemeral(
        jid,
        EphemeralDuration.TwentyFourHours
      );
      console.log("Set to 24h:", on.success, on.error || "");
      if (!on.success) return false;

      const off = await client.setCommunityEphemeral(jid, EphemeralDuration.Off);
      console.log("Disabled:", off.success, off.error || "");
      return off.success;
    },
  },
  {
    category: "Community Mgmt",
    name: "setCommunityMemberAddMode() - Switch who may add members",
    // Same as the group equivalent: the current mode is not readable, so this
    // ends on WhatsApp's default rather than what you had.
    destructive: true,
    action: async (client: MiawClient) => {
      const jid = await getTestGroup("Enter community JID (you must be admin):");
      console.log(
        "\n⚠️  The current mode is not readable; this ends on 'all_member_add'.\n"
      );

      const admins = await client.setCommunityMemberAddMode(jid, "admin_add");
      console.log("Admin-only:", admins.success, admins.error || "");
      if (!admins.success) return false;

      const all = await client.setCommunityMemberAddMode(jid, "all_member_add");
      console.log("Restored default:", all.success, all.error || "");
      return all.success;
    },
  },
  {
    category: "Community Mgmt",
    name: "approveCommunityJoinRequests() / rejectCommunityJoinRequests()",
    manual: true,
    action: async (client: MiawClient) => {
      const jid = await getTestGroup("Enter community JID (you must be admin):");

      const pending = await client.getCommunityJoinRequests(jid);
      if (pending.length === 0) {
        console.log(
          "\n⏭️  No pending join requests. Turn join approval ON, have someone"
        );
        console.log("   request to join, then re-run.");
        return "skipped";
      }

      console.log(`\nPending requests (${pending.length}):`);
      pending.forEach((r, i) => console.log(`  ${i + 1}. ${r.jid}`));

      const answer = await waitForInput(
        "\nApprove or reject the FIRST request? [a]pprove / [r]eject / [s]kip: "
      );
      const choice = answer.trim().toLowerCase();
      const target = pending[0].jid;

      if (choice === "a") {
        const result = await client.approveCommunityJoinRequests(jid, [target]);
        console.log("Approve:", JSON.stringify(result));
        return result.every((r) => r.success);
      }
      if (choice === "r") {
        const result = await client.rejectCommunityJoinRequests(jid, [target]);
        console.log("Reject:", JSON.stringify(result));
        return result.every((r) => r.success);
      }
      console.log("⏭️  Left the request pending.");
      return "skipped";
    },
  },
  {
    category: "Messaging",
    name: "pinMessage() / unpinMessage() - Pin a message then unpin it",
    manual: true,
    action: async (client: MiawClient) => {
      console.log("\n📝 Send a text message to the bot from another phone.");

      const message = await waitForMessage(
        client,
        (msg) => msg.type === "text",
        30000
      );

      console.log(`\n📌 Pinning message ${message.id} for 24 hours...`);
      const pinned = await client.pinMessage(message);
      console.log("Success:", pinned.success, pinned.error || "");
      if (!pinned.success) return false;

      console.log("\n📌 Unpinning it again...");
      const unpinned = await client.unpinMessage(message);
      console.log("Success:", unpinned.success, unpinned.error || "");
      return unpinned.success;
    },
  },
  {
    category: "Messaging",
    name: "setChatEphemeral() - Disappearing messages in a 1:1 chat",
    action: async (client: MiawClient) => {
      const phone = await getTestPhone("Enter phone number:");

      console.log("\n⏳ Setting disappearing messages to 24 hours...");
      const on = await client.setChatEphemeral(phone, 86400);
      console.log("Success:", on.success, on.error || "");
      if (!on.success) return false;

      console.log("\n↩️  Disabling it again...");
      const off = await client.setChatEphemeral(phone, 0);
      console.log("Success:", off.success, off.error || "");
      return off.success;
    },
  },
  {
    category: "Messaging",
    name: "sendGroupInvite() - Send a group invite card",
    action: async (client: MiawClient) => {
      const groupJid = await getTestGroup("Enter the group to invite TO:");
      const phone = await getTestPhone("Enter the phone number to invite:");

      // Returns the full https://chat.whatsapp.com/<code> URL, or null.
      const link = await client.getGroupInviteLink(groupJid);
      if (!link) {
        console.log("❌ Could not get an invite link (are you an admin?)");
        return false;
      }
      const inviteCode = link.split("/").pop() ?? "";
      if (!inviteCode) {
        console.log("❌ Could not parse an invite code out of:", link);
        return false;
      }

      const info = await client.getGroupInfo(groupJid);

      // Regression watch: Baileys fetches the group's picture to build the
      // card's thumbnail and does not guard that call, so a group with NO
      // picture makes WhatsApp answer item-not-found and the whole send
      // aborts. MiawClient overrides the hook to swallow that. Unit tests
      // cannot catch it -- a mocked socket never rejects -- so this entry is
      // the only guard. Prefer a pictureless group here.
      const result = await client.sendGroupInvite(phone, {
        groupJid,
        groupName: info?.name ?? "Test group",
        inviteCode,
        expiration: Math.floor(Date.now() / 1000) + 86400,
        caption: "Join us (miaw-core test)",
      });

      console.log("Success:", result.success, result.error || "");
      if (result.success) {
        console.log(
          "\n👀 Check the recipient: it should render as an invite CARD, not text."
        );
      }
      return result.success;
    },
  },

  // ============================================================
  // FINAL CLEANUP
  // ============================================================
  {
    category: "Final",
    name: "disconnect() - Disconnect from WhatsApp",
    action: async (client: MiawClient) => {
      console.log("\n🔌 Session complete!");
      console.log("   [d] Disconnect from WhatsApp");
      console.log("   [c] Keep connected (default)");
      const answer = await waitForInput("> [d/c]: ");

      if (answer.toLowerCase() === "d") {
        TEST_CONFIG.shouldDisconnect = true;
        console.log("\n🔌 Disconnecting from WhatsApp...");
        await client.disconnect();
        console.log("✅ Disconnected");
        return true;
      }

      console.log("✅ Keeping connection alive. You can continue testing.");
      return "skip";
    },
  },
];

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Warn about test config that silently invalidates results.
 *
 * Several entries compare two contacts, add a participant, or block someone.
 * If both configured numbers are the same, or are the connected account's own
 * number, those entries fail for reasons that have nothing to do with the code:
 * WhatsApp deduplicates a batch check, refuses a self-block, and will not add
 * you to a group you are already in. That looks exactly like a real defect in
 * the output, so say so up front.
 */
function warnOnDegenerateConfig(ownJid: string | undefined): void {
  const own = (ownJid || "").split(":")[0].split("@")[0];
  const a = TEST_CONFIG.testPhone;
  const b = TEST_CONFIG.testPhone2;
  const warnings: string[] = [];

  // Name the entries each problem actually breaks. Advice that does not track
  // which variable is wrong is worse than none: it sent a reader to fix B when
  // the participant and blocklist entries read A.
  if (a && b && a === b) {
    warnings.push(
      "TEST_CONTACT_PHONE_A and TEST_CONTACT_PHONE_B are the same number — " +
        "checkNumbers() deduplicates a repeated number and will report one result."
    );
  }
  if (own && a && a === own) {
    warnings.push(
      "TEST_CONTACT_PHONE_A is this account's OWN number. Sends become " +
        "send-to-self, and addParticipants(), promoteToAdmin(), " +
        "demoteFromAdmin() and blockContact() read A — WhatsApp refuses all " +
        "four against your own account. Point A at a real second number to " +
        "exercise them."
    );
  }
  if (own && b && b === own) {
    warnings.push(
      "TEST_CONTACT_PHONE_B is this account's OWN number — forwardMessage() " +
        "and createGroup() read B."
    );
  }
  if (!TEST_CONFIG.testGroupJid) {
    warnings.push("TEST_GROUP_JID is unset — group entries will prompt or skip.");
  }

  if (warnings.length === 0) return;

  console.log("\n⚠️  TEST CONFIG WARNINGS (.env.test)");
  for (const w of warnings) console.log(`   - ${w}`);
  console.log(
    "   Failures caused by the above are config problems, not miaw-core bugs."
  );
}

async function detectAccountType(client: MiawClient): Promise<void> {
  console.log("\n🔍 Detecting account type...");
  try {
    const profile = await client.getOwnProfile();
    if (profile) {
      TEST_CONFIG.isBusiness = profile.isBusiness || false;
      TEST_CONFIG.accountPhone = profile.phone || "";
      const accountType = TEST_CONFIG.isBusiness
        ? "💼 Business"
        : "👤 Personal";
      console.log(`✅ Account Type: ${accountType}`);
      console.log(`   Phone: ${TEST_CONFIG.accountPhone || "(not available)"}`);
      if (!TEST_CONFIG.isBusiness) {
        console.log("   ℹ️  Business-only tests will be skipped automatically");
      }
    }
  } catch {
    console.log("⚠️  Could not detect account type, assuming Personal");
    TEST_CONFIG.isBusiness = false;
  }
}

function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function waitForInput(prompt: string = ""): Promise<string> {
  if (AUTO_MODE) {
    // "" is what every caller already treats as "accept the default / cached
    // value", so auto mode needs no separate code path through the tests.
    if (prompt) console.log(`${prompt}(auto: default)`);
    return Promise.resolve("");
  }
  const rl = createReadlineInterface();
  return new Promise((resolve) => {
    rl.question(prompt, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function waitForEnter(prompt: string = ""): Promise<void> {
  if (AUTO_MODE) {
    if (prompt) console.log(`${prompt}(auto)`);
    return Promise.resolve();
  }
  const rl = createReadlineInterface();
  return new Promise((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

async function getTestPhone(prompt: string): Promise<string> {
  if (TEST_CONFIG.testPhone) {
    console.log(`${prompt} [cached: ${TEST_CONFIG.testPhone}]`);
    console.log("Press ENTER to use cached, or enter new number:");
    const answer = await waitForInput();
    if (answer) {
      TEST_CONFIG.testPhone = answer;
    }
    return TEST_CONFIG.testPhone;
  }

  console.log(`${prompt}`);
  const phone = await waitForInput();
  TEST_CONFIG.testPhone = phone;
  return phone;
}

async function getTestPhone2(prompt: string): Promise<string> {
  if (TEST_CONFIG.testPhone2) {
    console.log(`${prompt} [cached: ${TEST_CONFIG.testPhone2}]`);
    console.log("Press ENTER to use cached, or enter new number:");
    const answer = await waitForInput();
    if (answer) {
      TEST_CONFIG.testPhone2 = answer;
    }
    return TEST_CONFIG.testPhone2;
  }

  console.log(`${prompt}`);
  const phone = await waitForInput();
  TEST_CONFIG.testPhone2 = phone;
  return phone;
}

/**
 * A phone number that is NOT this account's own.
 *
 * Some entries need a genuine second party: WhatsApp refuses to add you to a
 * group you are already in, to promote/demote yourself, or to block yourself,
 * so pointing them at your own number produces failures that look like defects
 * but are config. When PHONE_A is the account's own number and PHONE_B is not,
 * this returns B; otherwise it falls back to the normal PHONE_A prompt.
 *
 * Deliberately does NOT change which number the send/media entries use — those
 * stay on PHONE_A, so a self-configured A keeps test traffic off a real phone.
 */
async function getOtherPartyPhone(prompt: string): Promise<string> {
  const own = TEST_CONFIG.accountPhone;
  const a = TEST_CONFIG.testPhone;
  const b = TEST_CONFIG.testPhone2;

  if (own && a === own && b && b !== own) {
    console.log(
      `${prompt} [using TEST_CONTACT_PHONE_B: ${b}]`
    );
    console.log(
      "   (PHONE_A is this account's own number, which WhatsApp would refuse)"
    );
    return b;
  }
  return getTestPhone(prompt);
}

async function getTestGroup(prompt: string): Promise<string> {
  if (TEST_CONFIG.testGroupJid) {
    console.log(`${prompt} [cached: ${TEST_CONFIG.testGroupJid}]`);
    console.log("Press ENTER to use cached, or enter new JID:");
    const answer = await waitForInput();
    if (answer) {
      TEST_CONFIG.testGroupJid = answer;
    }
    return TEST_CONFIG.testGroupJid;
  }

  console.log(`${prompt}`);
  const jid = await waitForInput();
  TEST_CONFIG.testGroupJid = jid;
  return jid;
}

function waitForMessage(
  client: MiawClient,
  condition: (msg: any) => boolean,
  timeout: number = 30000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.removeListener("message", handler);
      reject(new Error("Timeout waiting for message"));
    }, timeout);

    const handler = (msg: any) => {
      if (condition(msg)) {
        clearTimeout(timer);
        client.removeListener("message", handler);
        resolve(msg);
      }
    };

    client.on("message", handler);
  });
}

// ============================================================
// TEST EXECUTION
// ============================================================

async function runTest(
  test: TestItem,
  client?: MiawClient
): Promise<"pass" | "fail" | "skip"> {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`🧪 ${test.name}`);
  console.log("═".repeat(60));

  // Skip business-only tests for personal accounts
  if (test.businessOnly && !TEST_CONFIG.isBusiness) {
    console.log("⏭️  Skipped: Requires Business account");
    return "skip";
  }

  try {
    if (test.test) {
      // Simple test function (may be sync or async)
      const result = await test.test(client!);
      if (typeof result === "boolean") {
        return result ? "pass" : "fail";
      }
      return result as "pass" | "fail" | "skip";
    }

    if (test.action) {
      // Action that returns pass/fail/skip or boolean
      const result = await test.action(client!);
      if (typeof result === "boolean") {
        return result ? "pass" : "fail";
      }
      return result as "pass" | "fail" | "skip";
    }

    return "skip";
  } catch (error: any) {
    console.error("❌ Error:", error.message);
    return "fail";
  }
}

// Show help/usage information
function showHelp() {
  console.log(
    "\n╔════════════════════════════════════════════════════════════╗"
  );
  console.log("║     Miaw Core - Interactive Manual Testing Script        ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  console.log("\n📖 Usage: npm run test:manual [group]\n");
  console.log("Available test groups:\n");

  // Generated from CATEGORY_MAP so a new group cannot be added without
  // appearing here.
  const pad = Math.max(
    ...Object.keys(CATEGORY_MAP).map((k) => k.length),
    "all".length
  );
  console.log(`  ${"all".padEnd(pad)}  - Run all tests interactively`);
  for (const [group, { categories, description }] of Object.entries(CATEGORY_MAP)) {
    const count = tests.filter((t) => categories.includes(t.category)).length;
    console.log(`  ${group.padEnd(pad)}  - ${description} [${count}]`);
  }

  console.log("\n🤖 Unattended mode:");
  console.log("  npm run test:manual:auto              # all groups, no prompts");
  console.log("  npm run test:manual all -- --auto     # same thing");
  console.log("  npm run test:manual group -- --auto   # one group, no prompts");
  console.log("  AUTO=1 npm run test:manual all        # via env instead of a flag");
  console.log("");
  console.log("  Prompts resolve to their defaults (the .env.test values), entries");
  console.log("  needing a human are skipped, and the process exits non-zero if any");
  console.log("  test failed. Add --destructive to include the destructive entries.");

  console.log("\n💡 Examples:");
  console.log("  npm run test:manual all       # Run all tests");
  console.log(
    "  npm run test:manual group     # Run group management tests only"
  );
  console.log("  npm run test:manual messaging # Run messaging tests only");

  console.log(
    `\n🔧 Debug Mode: ${DEBUG_MODE ? "ON" : "OFF"} (set DEBUG=true in .env)`
  );

  console.log("\n");
}

// Get tests to run based on CLI argument
function getTestsToRun(): TestItem[] {
  if (cliArg === "all") {
    // For 'all', include setup tests only if not using existing session
    if (TEST_CONFIG.useExistingSession) {
      return tests.filter(
        (t) => t.category !== "Prerequisites" && t.category !== "Core Client"
      );
    }
    return tests;
  }

  const targetCategories = CATEGORY_MAP[cliArg]?.categories;
  if (!targetCategories) {
    return []; // Will trigger help display
  }

  // If using existing session, skip Prerequisites and Core Client setup
  if (TEST_CONFIG.useExistingSession) {
    const categoryTests = tests.filter((t) =>
      targetCategories.includes(t.category)
    );
    const disconnectTest = tests.filter((t) => t.category === "Final");
    return [...categoryTests, ...disconnectTest];
  }

  // Filter tests by category, but always include connection setup
  const connectionTests = tests.filter(
    (t) => t.category === "Prerequisites" || t.category === "Core Client"
  );
  const categoryTests = tests.filter((t) =>
    targetCategories.includes(t.category)
  );
  const disconnectTest = tests.filter((t) => t.category === "Final");

  // Combine: connection + category tests + disconnect
  // Remove duplicates if Core Client was selected
  const combined = [...connectionTests];
  for (const test of categoryTests) {
    if (!combined.some((t) => t.name === test.name)) {
      combined.push(test);
    }
  }
  combined.push(...disconnectTest);

  return combined;
}

async function main() {
  // If no argument or invalid argument, show help
  if (!cliArg || (!CATEGORY_MAP[cliArg] && cliArg !== "all")) {
    showHelp();
    return;
  }

  const targetDesc = cliArg === "all" ? "all tests" : `${cliArg} tests`;

  console.log(
    "\n╔════════════════════════════════════════════════════════════╗"
  );
  console.log("║     Miaw Core - Interactive Manual Testing Script        ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log(`\n🎯 Running: ${targetDesc}`);
  if (AUTO_MODE) {
    console.log("🤖 AUTO mode — no prompts, exits non-zero on failure");
    console.log(
      `   manual entries: skipped · destructive entries: ${AUTO_DESTRUCTIVE ? "INCLUDED" : "skipped"}`
    );
  }
  console.log("\nActions: [Enter] run | [n] skip | [s] skip all | [q] quit");
  console.log("Icons: ⚡ auto | 👤 interactive | [BIZ] business only");
  console.log(
    `\n🔧 Debug Mode: ${DEBUG_MODE ? "ON (verbose logging)" : "OFF (quiet)"}`
  );
  if (!DEBUG_MODE) {
    console.log(
      "   Tip: Set DEBUG=true in .env to enable verbose Baileys logs"
    );
  }

  // Show pre-loaded test contacts
  console.log("\n📋 Test Contacts (from .env.test):");
  if (TEST_CONFIG.testPhone) {
    console.log(`   Phone A: ${TEST_CONFIG.testPhone}`);
  } else {
    console.log("   Phone A: (not set - will prompt when needed)");
  }
  if (TEST_CONFIG.testPhone2) {
    console.log(`   Phone B: ${TEST_CONFIG.testPhone2}`);
  } else {
    console.log("   Phone B: (not set - will prompt when needed)");
  }
  if (TEST_CONFIG.testGroupJid) {
    console.log(`   Group:   ${TEST_CONFIG.testGroupJid}`);
  } else {
    console.log("   Group:   (not set - will prompt when needed)");
  }
  console.log(
    "   Tip: Set TEST_CONTACT_PHONE_A, TEST_CONTACT_PHONE_B, TEST_GROUP_JID in .env.test"
  );

  // Check if existing session exists
  const sessionDir = path.join(TEST_CONFIG.sessionPath, TEST_CONFIG.instanceId);
  const sessionExists = fs.existsSync(sessionDir);

  if (sessionExists) {
    console.log("\n📂 Existing session found!");
    console.log("   Continue with existing session or start fresh?");
    console.log("   [y] Continue with existing session (default)");
    console.log("   [n] Clear session and scan new QR code");
    const answer = await waitForInput("> [y/n]: ");
    if (answer.toLowerCase() === "n") {
      console.log("🗑️  Clearing existing session...");
      fs.rmSync(sessionDir, { recursive: true, force: true });
      console.log("✅ Session cleared. You will need to scan a new QR code.");
    } else {
      console.log("✅ Using existing session.");
      TEST_CONFIG.useExistingSession = true;
    }
  } else {
    console.log(
      "\n📂 No existing session found. You will need to scan a QR code."
    );
  }

  // Get tests to run (after session decision is made)
  const testsToRun = getTestsToRun();

  // Create client
  const client = new MiawClient({
    instanceId: TEST_CONFIG.instanceId,
    sessionPath: TEST_CONFIG.sessionPath,
    debug: DEBUG_MODE,
  });

  // Auto-connect if using existing session
  if (TEST_CONFIG.useExistingSession) {
    console.log("\n🔌 Auto-connecting with existing session...");
    client.connect();

    // Wait for ready
    const connected = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 30000);
      client.once("ready", () => {
        clearTimeout(timeout);
        resolve(true);
      });
    });

    if (!connected) {
      console.log("❌ Failed to connect with existing session.");
      console.log("   Try running with a fresh session.");
      process.exit(1);
    }

    console.log("✅ Connected!");
    await detectAccountType(client);
    warnOnDegenerateConfig(
      (client as unknown as { socket?: { user?: { id?: string } } }).socket?.user
        ?.id
    );
    console.log("\n🚀 Starting tests...\n");
  } else {
    await waitForEnter("\n> Press ENTER to start...");
  }

  // Run tests sequentially
  let lastResult: "pass" | "fail" | "skip" | null = null;

  for (let i = 0; i < testsToRun.length; i++) {
    const test = testsToRun[i];
    const progress = `[${i + 1}/${testsToRun.length}]`;
    const bizTag = test.businessOnly ? " [BIZ]" : "";
    const interactiveTag = test.action ? " 👤" : " ⚡"; // 👤 = needs interaction, ⚡ = auto

    // Show upcoming test info
    console.log(`\n${"-".repeat(60)}`);
    if (lastResult !== null) {
      const resultIcon =
        lastResult === "pass" ? "✅" : lastResult === "fail" ? "❌" : "⏭️";
      console.log(`Last: ${resultIcon} ${lastResult.toUpperCase()}`);
    }
    console.log(`Next ${progress}:${interactiveTag} ${test.name}${bizTag}`);

    if (AUTO_MODE) {
      // These need a human to send a message or place a call; env config
      // cannot stand in for that, so they are reported as skipped rather than
      // left to time out.
      if (test.manual) {
        testResults[test.name] = "skip";
        lastResult = "skip";
        console.log("⏭️  Skipped (needs a human — run without --auto)");
        continue;
      }
      if (test.destructive && !AUTO_DESTRUCTIVE) {
        testResults[test.name] = "skip";
        lastResult = "skip";
        console.log("⏭️  Skipped (destructive — pass --destructive to include)");
        continue;
      }
    } else {
      // Prompt for action
      const preAnswer = await waitForInput(
        "> [Enter] run | [n] skip | [q] quit: "
      );
      if (preAnswer.toLowerCase() === "q") break;
      if (preAnswer.toLowerCase() === "s") break;
      if (preAnswer.toLowerCase() === "n") {
        testResults[test.name] = "skip";
        lastResult = "skip";
        console.log(`⏭️  Skipped`);
        continue;
      }
    }

    const result = await runTest(test, client);
    testResults[test.name] = result;
    lastResult = result;
  }

  // Cleanup only if user explicitly chose to disconnect
  if (TEST_CONFIG.shouldDisconnect) {
    console.log("\n🧹 Cleaning up...");
    await client.dispose();
    console.log("✅ Cleanup complete");
  }

  // Show summary
  showSummary();

  if (AUTO_MODE) {
    // Machine-readable gate: unattended runs must fail the shell on a failure,
    // otherwise a red suite looks identical to a green one in CI or a script.
    const failed = Object.values(testResults).filter((r) => r === "fail").length;
    await client.dispose();
    process.exit(failed > 0 ? 1 : 0);
  }

  // Exit process (connection may still be active if user chose to keep it)
  process.exit(0);
}

function showSummary() {
  const results = { pass: 0, fail: 0, skip: 0 };

  for (const result of Object.values(testResults)) {
    results[result]++;
  }

  console.log("\n════════════════════════════════════════════════════════════");
  console.log("                      Test Summary");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`  ✅ Passed:  ${results.pass}`);
  console.log(`  ❌ Failed:  ${results.fail}`);
  console.log(`  ⏭️  Skipped: ${results.skip}`);
  console.log(`  📊 Total:   ${Object.keys(testResults).length}`);
  console.log("════════════════════════════════════════════════════════════\n");
}

// Run the test
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
