/**
 * Unit tests for the history-sync gate.
 *
 * syncFullHistory:false must reject only the FULL sync. Rejecting every type
 * is what Baileys warns about ("DISABLING ALL SYNC ... PREVENTS BAILEYS FROM
 * ACCESSING INITIAL LID MAPPINGS, LEADING TO INSTABILITY AND SESSION ERRORS"),
 * and this library depends on those @lid mappings.
 */

import { describe, it, expect } from "@jest/globals";
import { proto } from "@whiskeysockets/baileys";
import { shouldSyncHistoryType } from "../../src/utils/history-sync.js";

const T = proto.HistorySync.HistorySyncType;
const ALL = Object.values(T).filter((v): v is number => typeof v === "number");

describe("shouldSyncHistoryType", () => {
  it("keeps its inlined FULL constant in step with Baileys", () => {
    // The module inlines the value to stay importable from tests that mock
    // Baileys; this is the check that the inlined copy is still correct.
    expect(shouldSyncHistoryType(false, T.FULL)).toBe(false);
    expect(T.FULL).toBe(2);
  });

  it("accepts every sync type when syncFullHistory is on", () => {
    for (const syncType of ALL) {
      expect(shouldSyncHistoryType(true, syncType)).toBe(true);
    }
  });

  it("rejects only FULL when syncFullHistory is off", () => {
    for (const syncType of ALL) {
      expect(shouldSyncHistoryType(false, syncType)).toBe(syncType !== T.FULL);
    }
  });

  it("keeps the bootstrap and push-name syncs that carry the initial lid mappings", () => {
    // Regression guard: these two are the ones Baileys names in its warning.
    expect(shouldSyncHistoryType(false, T.INITIAL_BOOTSTRAP)).toBe(true);
    expect(shouldSyncHistoryType(false, T.PUSH_NAME)).toBe(true);
  });

  it("treats an undefined option as off", () => {
    expect(shouldSyncHistoryType(undefined, T.FULL)).toBe(false);
    expect(shouldSyncHistoryType(undefined, T.RECENT)).toBe(true);
  });
});
