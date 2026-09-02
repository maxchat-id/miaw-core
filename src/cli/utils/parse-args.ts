/**
 * Shared CLI argument parsers (v1.12.0).
 *
 * These live here rather than in a command module because the group, community
 * and chat surfaces all parse the same argument shapes, and importing a parser
 * from a sibling command file would tangle them together.
 */

/**
 * Parse an on/off style flag argument.
 *
 * Accepts the spellings people actually type, in either case:
 * `on`/`off`, `true`/`false`, `yes`/`no`, `1`/`0`.
 *
 * @returns the boolean, or `null` when the value is not recognized — callers
 *   print a usage line rather than guessing, since guessing wrong here silently
 *   flips a group setting the wrong way.
 */
export function parseToggle(value: string | undefined): boolean | null {
  switch ((value || "").toLowerCase()) {
    case "on":
    case "true":
    case "yes":
    case "1":
      return true;
    case "off":
    case "false":
    case "no":
    case "0":
      return false;
    default:
      return null;
  }
}

/**
 * Named disappearing-message durations accepted on the CLI.
 * Mirrors the four values the WhatsApp UI exposes; raw seconds also work.
 */
export const EPHEMERAL_ALIASES: Record<string, number> = {
  off: 0,
  "24h": 86400,
  "7d": 604800,
  "90d": 7776000,
};

/**
 * Parse a disappearing-message duration: a named alias or a raw second count.
 *
 * @returns the duration in seconds, or `null` when missing or unparseable
 *
 * The empty-value guard is load-bearing, not defensive: `Number("")` is `0`,
 * and `0` is a *valid* duration meaning "off". Without it, omitting the
 * argument entirely would parse as a successful request to disable
 * disappearing messages, so `miaw-cli group ephemeral <jid>` would silently
 * turn them off for the whole group instead of printing a usage line.
 */
export function parseEphemeral(value: string | undefined): number | null {
  const key = value?.trim().toLowerCase();
  if (!key) {
    return null;
  }

  if (key in EPHEMERAL_ALIASES) {
    return EPHEMERAL_ALIASES[key];
  }

  const seconds = Number(key);
  return Number.isInteger(seconds) && seconds >= 0 ? seconds : null;
}

/**
 * Parse a member-add mode argument.
 * @returns the mode, or `null` when unrecognized
 */
export function parseMemberAddMode(
  value: string | undefined
): "admin_add" | "all_member_add" | null {
  switch ((value || "").toLowerCase()) {
    case "admin":
    case "admin_add":
    case "admins":
      return "admin_add";
    case "all":
    case "all_member_add":
    case "members":
      return "all_member_add";
    default:
      return null;
  }
}
