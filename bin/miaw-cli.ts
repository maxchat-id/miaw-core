#!/usr/bin/env -S npx tsx
/**
 * miaw-cli, run straight from the TypeScript sources.
 *
 * This is the development entry (`npm run cli`), executed through tsx. The
 * PUBLISHED executable is bin/miaw-cli.mjs, which runs the compiled build —
 * see package.json `bin`. Keep both pointing at the same `main()`.
 */
import { main } from "../src/cli/main.js";

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
