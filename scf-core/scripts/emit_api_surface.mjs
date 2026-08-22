// SPDX-License-Identifier: Apache-2.0
/**
 * emit_api_surface.mjs — write spec/api-surface.json.
 *
 * WHAT THIS IS FOR.
 *
 * `src/index.ts` re-exports eighteen modules with `export *`. That is
 * convenient and it means the package has no stated public surface:
 * every helper written for internal use is exported by accident, and
 * nothing distinguishes a name meant for consumers from a name that
 * happens to be reachable.
 *
 * That costs nothing while the package is unpublished. It becomes a
 * compatibility obligation the moment somebody installs it, because a
 * name they can import is a name they will import, and removing it
 * afterwards is a breaking change whether or not it was ever intended
 * as API.
 *
 * WHAT THIS DOES AND DOES NOT DO.
 *
 * This file PINS the surface. It does not DECIDE it. Every exported
 * name is recorded with its kind, so that a name entering or leaving
 * the surface shows up as a diff in review rather than silently, the
 * same guarantee the registry and the finding catalog already have.
 *
 * Deciding which of these are actually API — and cutting the rest to
 * internal — is still owed, and is much cheaper before 1.0 than after.
 * This artifact is the list to do it against.
 *
 * Type-only exports are included. They matter more than value exports
 * to a TypeScript consumer and are invisible at runtime, so a surface
 * derived by importing the module would miss them entirely.
 *
 *   node --experimental-strip-types scripts/emit_api_surface.mjs
 *   node --experimental-strip-types scripts/emit_api_surface.mjs --check
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..");
const OUT = join(PKG, "..", "spec", "api-surface.json");

/** The entry points a consumer can reach, per package.json `exports`. */
const ENTRIES = {
  ".": "src/index.ts",
  "./node": "src/node.ts",
};

const KIND = {
  [ts.SymbolFlags.Function]: "function",
  [ts.SymbolFlags.Class]: "class",
  [ts.SymbolFlags.Interface]: "interface",
  [ts.SymbolFlags.TypeAlias]: "type",
  [ts.SymbolFlags.Enum]: "enum",
  [ts.SymbolFlags.Variable]: "value",
  [ts.SymbolFlags.BlockScopedVariable]: "value",
};

function kindOf(symbol, checker) {
  const resolved = symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;
  for (const [flag, name] of Object.entries(KIND)) {
    if (resolved.flags & Number(flag)) return name;
  }
  // A const declared with an arrow function reads as a variable; call it
  // what a consumer would call it.
  const decl = resolved.declarations?.[0];
  if (decl && ts.isVariableDeclaration(decl) && decl.initializer
      && (ts.isArrowFunction(decl.initializer)
          || ts.isFunctionExpression(decl.initializer))) {
    return "function";
  }
  return "value";
}

const program = ts.createProgram(
  Object.values(ENTRIES).map((p) => join(PKG, p)),
  {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    resolveJsonModule: true,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
  },
);
const checker = program.getTypeChecker();

/**
 * Every type named in a public signature must itself be public.
 *
 * This is the invariant that makes a surface usable rather than merely
 * small. If `q05Result()` is exported and its return type `Q05Result` is
 * not, a consumer can call the function and cannot write down what it
 * gave them — no variable annotation, no wrapper signature, no
 * re-export. The failure is silent at our end and immediate at theirs,
 * which is the worst place for it to show up.
 *
 * Checked on syntax rather than by walking resolved types: a type
 * reference written in a declaration is exactly what a consumer has to
 * be able to name, and inferred structure they never spell out is not.
 */
function closureViolations(_unused, exported, checker, nameable = exported) {
  const srcDir = join(PKG, "src");
  const bad = [];
  for (const symbol of exported.values()) {
    const resolved = symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol) : symbol;
    for (const decl of resolved.declarations ?? []) {
      const owner = decl.getSourceFile().fileName;
      if (!owner.startsWith(srcDir)) continue;
      const seen = new Set();
      const visit = (node) => {
        if (ts.isTypeReferenceNode(node)) {
          const name = ts.isQualifiedName(node.typeName)
            ? node.typeName.right.text : node.typeName.text;
          if (!seen.has(name)) {
            seen.add(name);
            const sym = checker.getSymbolAtLocation(
              ts.isQualifiedName(node.typeName)
                ? node.typeName.right : node.typeName);
            const target = sym && sym.flags & ts.SymbolFlags.Alias
              ? checker.getAliasedSymbol(sym) : sym;
            const home0 = target?.declarations?.[0];
            // A generic parameter is not a type a consumer names; it is
            // filled in at the call site.
            if (home0 && ts.isTypeParameterDeclaration(home0)) return;
            const home = home0?.getSourceFile().fileName;
            if (home && home.startsWith(srcDir) && !nameable.has(name)) {
              bad.push({
                exportName: resolved.getName(),
                needs: name,
                from: home.slice(srcDir.length + 1),
              });
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      // Signature and type position only: a function BODY may mention
      // whatever it likes, and none of it reaches a consumer.
      if (ts.isFunctionDeclaration(decl) || ts.isMethodDeclaration(decl)) {
        decl.parameters.forEach(visit);
        if (decl.type) visit(decl.type);
        decl.typeParameters?.forEach(visit);
      } else if (ts.isVariableDeclaration(decl)) {
        if (decl.type) visit(decl.type);
      } else {
        visit(decl);
      }
    }
  }
  return bad;
}

const entries = {};
let total = 0;
const violations = [];
/** Checked after every entry point is known — see the note below. */
const pending = [];
for (const [specifier, rel] of Object.entries(ENTRIES)) {
  const source = program.getSourceFile(join(PKG, rel));
  if (!source) {
    console.error(`[api-surface] entry not found: ${rel}`);
    process.exit(1);
  }
  const moduleSymbol = checker.getSymbolAtLocation(source);
  const names = {};
  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    names[symbol.getName()] = kindOf(symbol, checker);
  }
  const exportedSymbols = new Map(
    checker.getExportsOfModule(moduleSymbol).map((s) => [s.getName(), s]));
  pending.push(exportedSymbols);

  const sorted = Object.keys(names).sort();
  entries[specifier] = {
    module: rel,
    count: sorted.length,
    exports: Object.fromEntries(sorted.map((n) => [n, names[n]])),
  };
  total += sorted.length;
}

const text = `${JSON.stringify({
  $comment:
    "GENERATED by scf-core/scripts/emit_api_surface.mjs. Do not " +
    "hand-edit. Every name a consumer of @minimalhumans/scf-core can " +
    "import, per entry point, with its kind. This PINS the surface so " +
    "a change to it is a visible diff; it does not assert that every " +
    "name here is intended as API. See the file header.",
  package: "@minimalhumans/scf-core",
  stability:
    "The package is unpublished and pre-1.0. Nothing here is stable " +
    "yet, and the set is expected to SHRINK before 1.0 as names " +
    "written for internal use are cut from the entry points.",
  total,
  entries,
}, null, 2)}\n`;

// The nameable set is the UNION across entry points, because a consumer
// importing "@minimalhumans/scf-core/node" can still name a type from
// "@minimalhumans/scf-core". Checking each entry in isolation would
// report reachable types as missing.
const nameable = new Map();
for (const m of pending) for (const [k, v] of m) nameable.set(k, v);
for (const m of pending) violations.push(...closureViolations(null, m, checker,
  nameable));

if (violations.length > 0) {
  console.error(
    "[api-surface] the surface is not self-contained. A consumer can " +
    "call these\n  but cannot name what they take or return:\n");
  const shown = new Set();
  for (const v of violations) {
    const key = `${v.exportName}:${v.needs}`;
    if (shown.has(key)) continue;
    shown.add(key);
    console.error(`  ${v.exportName} needs ${v.needs} (src/${v.from})`);
  }
  console.error(
    "\n  Export the missing types from src/index.ts, or stop exporting " +
    "what needs them.");
  process.exit(1);
}

if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(OUT, "utf8"); } catch { /* missing */ }
  if (current !== text) {
    console.error(
      "[api-surface.json] STALE — the public surface changed.\n" +
      "  If that was deliberate, run: npm run emit-api-surface\n" +
      "  If it was not, something internal became importable.");
    process.exit(1);
  }
  console.log(`[api-surface.json] up to date (${String(total)} exports).`);
} else {
  writeFileSync(OUT, text, "utf8");
  console.log(`[api-surface.json] wrote ${String(total)} exports across ` +
              `${String(Object.keys(entries).length)} entry points.`);
}
