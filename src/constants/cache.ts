/**
 * Cache configuration constants
 */

export const CACHE_CONFIG = {
  /** Maximum size for LID to JID mapping cache */
  LID_MAP_MAX_SIZE: 1000,
  /** Groups whose members' LID -> phone pairs are kept (learned from group metadata) */
  GROUP_MEMBERS_MAX_GROUPS: 200,
  /** Total LID -> phone pairs kept across those groups (oldest groups go first) */
  GROUP_MEMBERS_MAX_ENTRIES: 20_000,
  /** An unresolved LID is logged at most once in this window */
  LID_WARN_WINDOW_MS: 10 * 60 * 1000,
  /** Unresolved LIDs remembered for the log window before the list is reset */
  LID_WARN_MAX_ENTRIES: 1000,
} as const;
