/**
 * Miscellaneous Commands
 *
 * Utility commands like check numbers, etc.
 */

import { MiawClient } from "../../index.js";
import { ensureConnected } from "../utils/session.js";
import { formatTable } from "../utils/formatter.js";

/**
 * Check if phone number is on WhatsApp
 */
export async function cmdCheck(
  client: MiawClient,
  args: { phones: string[] },
  jsonOutput: boolean
): Promise<boolean> {
  const result = await ensureConnected(client);
  if (!result.success) {
    console.log(`❌ Not connected: ${result.reason}`);
    return false;
  }

  // Progress text on stdout corrupts --json: the consumer gets
  // "🔍 Checking 1 phone number(s)...{...}" and JSON.parse throws.
  if (!jsonOutput) {
    console.log(`🔍 Checking ${args.phones.length} phone number(s)...\n`);
  }

  const results = await client.checkNumbers(args.phones);

  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
    return true;
  }

  const tableData = results.map((r, i) => ({
    phone: args.phones[i],
    exists: r.exists ? "Yes" : "No",
    jid: r.jid || "-",
  }));

  console.log(
    formatTable(tableData, [
      { key: "phone", label: "Phone", width: 20 },
      { key: "exists", label: "On WhatsApp", width: 15 },
      { key: "jid", label: "JID", width: 40 },
    ])
  );

  const existsCount = results.filter((r) => r.exists).length;
  console.log(`\n✅ ${existsCount}/${args.phones.length} numbers are on WhatsApp`);

  return true;
}
