/**
 * Call Commands (v1.12.0)
 *
 * Create shareable call links. Rejecting a call is an event-driven operation —
 * it only works while a call is ringing — so it belongs in a bot's `call`
 * handler rather than on the CLI.
 */

import { MiawClient } from "../../index.js";
import { ensureConnected } from "../utils/session.js";
import { formatMessage } from "../utils/formatter.js";

/**
 * Create a shareable call link
 */
export async function cmdCallLink(
  client: MiawClient,
  args: { type: "audio" | "video"; startTime?: number }
): Promise<boolean> {
  const conn = await ensureConnected(client);
  if (!conn.success) {
    console.log(`❌ Not connected: ${conn.reason}`);
    return false;
  }

  console.log(`🔗 Creating ${args.type} call link...`);

  const link = await client.createCallLink(args.type, args.startTime);

  if (!link) {
    console.log(formatMessage(false, "Failed to create call link"));
    return false;
  }

  console.log(formatMessage(true, "Call link created"));
  console.log(`\n${link}\n`);
  return true;
}
