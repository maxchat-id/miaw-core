/**
 * Unit Tests: package entry points and runtime dependencies
 *
 * Guards two bugs that shipped undetected because nothing tested the package
 * *as published*, only as a working copy:
 *
 * 1. `bin.miaw-cli` pointed at `bin/miaw-cli.ts` — a TypeScript file with a
 *    `#!/usr/bin/env node` shebang, importing from `../src/**`. Plain node
 *    cannot resolve TypeScript's `.js`-for-`.ts` specifiers, and `.npmignore`
 *    excludes `src/` from the tarball, so `npx miaw-cli` was broken both
 *    locally and for every published consumer.
 * 2. `dotenv` was imported by the CLI at runtime but declared only in
 *    devDependencies, so the installed package could not start.
 *
 * Neither is visible from inside the repo, where src/ exists and devDeps are
 * installed. These assertions approximate "would this work once published".
 */

import { describe, it, expect } from "@jest/globals";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

/** Node built-ins, which never need declaring. */
const BUILTINS = new Set([
  "assert", "buffer", "child_process", "crypto", "events", "fs", "http",
  "https", "net", "os", "path", "perf_hooks", "querystring", "readline",
  "stream", "string_decoder", "timers", "tls", "url", "util", "worker_threads",
  "zlib",
]);

/** Every .ts under src/, plus the published .mjs bin shim. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".ts")) out.push(full);
    }
  };
  walk(path.join(root, "src"));
  for (const f of fs.readdirSync(path.join(root, "bin"))) {
    if (f.endsWith(".mjs")) out.push(path.join(root, "bin", f));
  }
  return out;
}

/**
 * Bare package specifiers imported by a file.
 *
 * Deliberately anchored to statement-position `import`/`export ... from` so it
 * cannot pick up strings inside template literals or comments — a looser regex
 * reports phone numbers and `${...}` fragments as packages.
 */
function bareImports(file: string): string[] {
  const src = fs.readFileSync(file, "utf8");
  const specs = new Set<string>();
  const patterns = [
    /^\s*import\s+[^;]*?\sfrom\s+["']([^"']+)["']/gm,
    /^\s*import\s+["']([^"']+)["']/gm,
    /^\s*export\s+[^;]*?\sfrom\s+["']([^"']+)["']/gm,
    /\bawait\s+import\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      const spec = m[1].replace(/^node:/, "");
      if (spec.startsWith(".") || spec.startsWith("/")) continue;
      const top = spec.startsWith("@")
        ? spec.split("/").slice(0, 2).join("/")
        : spec.split("/")[0];
      if (!BUILTINS.has(top)) specs.add(top);
    }
  }
  return [...specs];
}

describe("published bin entry", () => {
  it("declares a bin", () => {
    expect(pkg.bin).toBeDefined();
    expect(pkg.bin["miaw-cli"]).toBeTruthy();
  });

  it("points at a file that exists", () => {
    const target = path.join(root, pkg.bin["miaw-cli"]);
    expect(fs.existsSync(target)).toBe(true);
  });

  it("points at JavaScript, not TypeScript", () => {
    // A bin runs under the user's plain `node`, with no TS loader.
    expect(pkg.bin["miaw-cli"]).toMatch(/\.(mjs|cjs|js)$/);
  });

  it("has a node shebang", () => {
    const target = path.join(root, pkg.bin["miaw-cli"]);
    const first = fs.readFileSync(target, "utf8").split("\n")[0];
    expect(first).toMatch(/^#!.*node/);
  });

  it("resolves its entry into dist/, not src/", () => {
    // src/ is excluded by .npmignore, so a bin reaching into it cannot work
    // once installed. Strip comments first — this file documents the old
    // broken path in prose, which a naive scan would flag.
    const body = fs
      .readFileSync(path.join(root, pkg.bin["miaw-cli"]), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(body).not.toMatch(/\.\.\/src\//);
    expect(body).toMatch(/dist/);
  });

  it("is not excluded from the published package", () => {
    const ignore = fs.readFileSync(path.join(root, ".npmignore"), "utf8");
    const patterns = ignore
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    const binPath = pkg.bin["miaw-cli"].replace(/^\.\//, "");
    expect(patterns).not.toContain(binPath);
  });
});

describe("runtime dependencies", () => {
  const declared = new Set(Object.keys(pkg.dependencies ?? {}));
  const dev = new Set(Object.keys(pkg.devDependencies ?? {}));

  it("declares every package imported by src/ and the bin shim", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      for (const spec of bareImports(file)) {
        if (declared.has(spec)) continue;
        const where = dev.has(spec) ? "devDependencies" : "undeclared";
        offenders.push(
          `${spec} (${where}) imported by ${path.relative(root, file)}`
        );
      }
    }
    // Anything here fails only once installed — never in this working copy,
    // where devDependencies are present.
    expect(offenders).toEqual([]);
  });

  it("keeps dotenv as a runtime dependency", () => {
    // Regression guard: the CLI calls dotenv.config() on startup.
    expect(declared.has("dotenv")).toBe(true);
    expect(dev.has("dotenv")).toBe(false);
  });
});
