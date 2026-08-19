/**
 * Unit tests for AuthHandler.clearSession().
 *
 * clearSession() removed the instance directory itself. The socket being torn
 * down keeps writing keys for a moment, and `useMultiFileAuthState` only
 * recreates the directory when the next connect initialises it — so a write
 * landing in that gap fails with
 *
 *   ENOENT: no such file or directory, open 'sessions/<id>/creds.json'
 *
 * as an unhandled rejection. Seen on staging 2026-08-19: the rejection aborted
 * the pairing that followed a logout, and every scan bounced back to the QR
 * screen until the process was restarted.
 *
 * Emptying the directory clears exactly as much state, and leaves nothing that
 * can vanish underneath a writer.
 */

import { jest, describe, beforeEach, afterEach, it, expect } from "@jest/globals";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

jest.unstable_mockModule("@whiskeysockets/baileys", () => ({
  useMultiFileAuthState: jest.fn<() => Promise<unknown>>(),
}));

const { AuthHandler } = await import("../../src/handlers/AuthHandler.js");

const INSTANCE_ID = "clear-session-instance";
let sessionPath: string;
let authPath: string;

function makeHandler() {
  return new AuthHandler(sessionPath, INSTANCE_ID);
}

/** A session directory shaped like the real thing: files plus a nested dir. */
function seedSession(): void {
  mkdirSync(join(authPath, "keys"), { recursive: true });
  writeFileSync(join(authPath, "creds.json"), "{}");
  writeFileSync(join(authPath, "messages.json"), "{}");
  writeFileSync(join(authPath, "pre-key-1.json"), "{}");
  writeFileSync(join(authPath, "keys", "session-1.json"), "{}");
}

describe("AuthHandler.clearSession", () => {
  beforeEach(() => {
    sessionPath = join(tmpdir(), `miaw-clear-session-${Date.now()}-${Math.random()}`);
    authPath = join(sessionPath, INSTANCE_ID);
    mkdirSync(authPath, { recursive: true });
  });

  afterEach(() => {
    rmSync(sessionPath, { recursive: true, force: true });
  });

  it("keeps the instance directory so a late write cannot hit ENOENT", () => {
    seedSession();

    makeHandler().clearSession();

    expect(existsSync(authPath)).toBe(true);
  });

  it("lets a write land immediately afterwards", () => {
    seedSession();

    makeHandler().clearSession();

    expect(() => writeFileSync(join(authPath, "creds.json"), "{}")).not.toThrow();
  });

  it("removes every session file", () => {
    seedSession();

    makeHandler().clearSession();

    expect(readdirSync(authPath)).toEqual([]);
  });

  it("removes nested directories too", () => {
    seedSession();

    makeHandler().clearSession();

    expect(existsSync(join(authPath, "keys"))).toBe(false);
  });

  it("reports true when there was a session to clear", () => {
    seedSession();

    expect(makeHandler().clearSession()).toBe(true);
  });

  it("reports false when the instance has no session directory", () => {
    rmSync(authPath, { recursive: true, force: true });

    expect(makeHandler().clearSession()).toBe(false);
  });

  it("is safe to call twice", () => {
    seedSession();
    const handler = makeHandler();

    handler.clearSession();

    expect(() => handler.clearSession()).not.toThrow();
    expect(existsSync(authPath)).toBe(true);
  });
});
