/**
 * Browser identity presets for the `browser` client option.
 *
 * WhatsApp is told what kind of client is connecting via a three-part tuple,
 * `[os, browserName, version]`, and it treats the choice as load-bearing: it
 * decides the label the linked device shows on the phone, how deep a history
 * sync you are given, and — since rc14 — whether the handshake is negotiated as
 * a web client or as an Android one.
 *
 * These mirror Baileys' own `Browsers` map. They are duplicated rather than
 * re-exported on purpose: `src/index.ts` is imported by suites that do not mock
 * Baileys, so re-exporting from the real module would pull its native bridge
 * into the unit tests, and every existing mock factory stubs `Browsers` as
 * `{ macOS }` alone. Plain tuples keep this module free of any Baileys
 * dependency at all. `browser` also accepts a raw tuple, so nothing here is
 * required — these are the spellings that are known to work.
 *
 * @see https://github.com/WhiskeySockets/Baileys/issues/2671
 */

/** Browser identity tuple sent to WhatsApp: `[os, browserName, version]`. */
export type BrowserTuple = [string, string, string];

export const BrowserPresets = {
  /** Default identity used by MiawClient when `browser` is not set. */
  macOS: (browser = "Chrome"): BrowserTuple => ["Mac OS", browser, "14.4.1"],

  windows: (browser = "Chrome"): BrowserTuple => [
    "Windows",
    browser,
    "10.0.22631",
  ],

  ubuntu: (browser = "Chrome"): BrowserTuple => ["Ubuntu", browser, "22.04.4"],

  /**
   * Experimental Android identity (Baileys 7.0.0-rc14 and later).
   *
   * An Android-linked session can **receive view-once media**, which a web
   * session cannot — miaw-core already normalizes those, so `message.media.viewOnce`
   * and `downloadMedia()` start working with no further change.
   *
   * The cost: Baileys itself logs "experimental ... use at your own risk" for
   * this identity, the linked device is labelled differently on the phone, and
   * history sync may be shallower. Prefer it on a dedicated instance rather than
   * switching an established session over.
   *
   * Note the unusual slot order — the Android version goes in the `os` slot, and
   * the literal "Android" in the `browserName` slot. That is what the handshake
   * looks for (`browser[1]` is tested for "android" to pick `Platform.ANDROID`
   * over `Platform.WEB`), so the order is not cosmetic.
   *
   * @param version - Android release to report (default: "13")
   */
  android: (version = "13"): BrowserTuple => [version, "Android", ""],
} as const;
