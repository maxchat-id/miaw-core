/**
 * `proto.HistorySync.HistorySyncType.FULL`, inlined.
 *
 * Importing `proto` here would pull Baileys into every module that reaches
 * this file, and the unit tests mock Baileys without it. The value is a wire
 * protocol enum, so it is fixed; history-sync.test.ts asserts it still matches
 * the real one.
 */
const HISTORY_SYNC_TYPE_FULL = 2;

/**
 * Decide whether to accept one history-sync payload.
 *
 * `syncFullHistory: false` must reject only the FULL sync — the one that
 * makes `useMultiFileAuthState` write thousands of key files. Rejecting every
 * type also drops INITIAL_BOOTSTRAP and PUSH_NAME, which is where the initial
 * @lid mappings arrive; Baileys warns that losing those leads to session
 * errors. This mirrors Baileys' own default (`syncType !== FULL`).
 */
export function shouldSyncHistoryType(
  syncFullHistory: boolean | undefined,
  syncType: number | null | undefined
): boolean {
  if (syncFullHistory) {
    return true;
  }
  return syncType !== HISTORY_SYNC_TYPE_FULL;
}
