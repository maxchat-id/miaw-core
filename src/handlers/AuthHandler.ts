import { useMultiFileAuthState } from "@whiskeysockets/baileys";
import { join } from "node:path";
import { readdirSync, rmSync, existsSync } from "node:fs";

/**
 * Handles authentication state management
 */
export class AuthHandler {
  private sessionPath: string;
  private instanceId: string;

  constructor(sessionPath: string, instanceId: string) {
    this.sessionPath = sessionPath;
    this.instanceId = instanceId;
  }

  /**
   * Initialize and load auth state
   * Returns { state, saveCreds } from Baileys
   */
  async initialize() {
    const authPath = join(this.sessionPath, this.instanceId);
    return await useMultiFileAuthState(authPath);
  }

  /**
   * Get the full path to the session directory for this instance
   */
  getAuthPath(): string {
    return join(this.sessionPath, this.instanceId);
  }

  /**
   * Clear all session files for this instance.
   * This is needed when logged out to allow fresh QR code authentication.
   *
   * The directory itself is kept. A socket that is shutting down keeps writing
   * keys for a moment, and `useMultiFileAuthState` only recreates the directory
   * on the next initialize() — a write landing in that gap fails with ENOENT as
   * an unhandled rejection, which is enough to abort the pairing that follows a
   * logout.
   */
  clearSession(): boolean {
    const authPath = this.getAuthPath();
    if (!existsSync(authPath)) {
      return false;
    }
    for (const entry of readdirSync(authPath)) {
      rmSync(join(authPath, entry), { recursive: true, force: true });
    }
    return true;
  }
}
