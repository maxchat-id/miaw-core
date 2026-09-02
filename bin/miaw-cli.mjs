#!/usr/bin/env node
/**
 * miaw-cli executable (published entry point).
 *
 * Plain JavaScript on purpose: `bin` entries are run by whatever `node` the
 * user has, with no TypeScript loader. The previous entry was a .ts file with
 * a `#!/usr/bin/env node` shebang that imported from ../src/**, so it failed
 * twice over -- node cannot resolve TypeScript's `.js`-for-`.ts` specifiers,
 * and .npmignore excludes src/ from the published package entirely.
 *
 * Requires a build: run `npm run build` first, or use `npm run cli` (tsx) for
 * development against the sources.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "..", "dist", "cli", "main.js");

if (!existsSync(entry)) {
  console.error("❌ miaw-cli: dist/ is missing — the package was not built.");
  console.error("   Run `npm run build`, or use `npm run cli` to run from source.");
  process.exit(1);
}

const { main } = await import(entry);
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
