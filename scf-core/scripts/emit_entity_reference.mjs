// SPDX-License-Identifier: Apache-2.0
/**
 * emit_entity_reference.mjs — write spec/entity-reference.md.
 *
 * Ninety-nine entities and roughly seven hundred fields, from
 * `registry.json`, which is itself generated from
 * `schema/entity_registry.py`.
 *
 * WHY THIS IS GENERATED.
 *
 * The release checklist has wanted an entity reference for a long time,
 * and the obvious way to produce one is to write it. That would be a
 * second description of the registry: ninety-nine entities' worth of
 * prose, correct on the day it was written and drifting from the
 * schema by the following week. Every recurring defect this project has
 * found has that shape — one rule described in two places, disagreeing.
 *
 * So this is derived, checked in CI, and carries nothing a reader could
 * not get from `registry.json`. What it adds is legibility: the JSON is
 * for programs, and nobody browses it.
 *
 * WHAT IT IS NOT.
 *
 * Not normative. `spec/scf-spec.md` states the rules and the registry
 * states the field set; this document restates the second in a form a
 * person can read, and says so at the top of its own output. Where it
 * disagrees with either, they win and this is a bug.
 *
 * It also does not explain what entities are FOR. `description` and
 * `helpText` come from the registry and are as good as what is written
 * there. The authoring guide is a separate, human job and this file
 * cannot do it.
 *
 *   node --experimental-strip-types scripts/emit_entity_reference.mjs
 *   node --experimental-strip-types scripts/emit_entity_reference.mjs --check
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..");
const REGISTRY = join(PKG, "registry", "registry.json");
const OUT = join(PKG, "..", "spec", "entity-reference.md");

const registry = JSON.parse(readFileSync(REGISTRY, "utf8"));

function registryTierLabels() {
  const labels = registry.tierLabels;
  if (!labels || Object.keys(labels).length === 0) {
    console.error("[entity-reference] registry.json carries no tierLabels — " +
                  "regenerate it: python3 schema/generate_registry_json.py");
    process.exit(1);
  }
  return labels;
}
const entities = registry.entities;
const byName = new Map(entities.map((e) => [e.name, e]));

/**
 * Tier names come from the registry, which gained `tierLabels` for this.
 *
 * They were invented here first, and four of the seven were wrong —
 * "Production" was put on tier 4, which is Thematic tracking, and tier 6,
 * which IS Production, was called "Connections". Nobody would have
 * noticed from reading the output. The names had lived as banner
 * comments in entity_registry.py and nowhere a generator could reach,
 * which is the same defect this project keeps finding.
 */
const TIERS = registryTierLabels();

/** Position patterns. Spec §4.5. */
const PATTERNS = {
  none: "Not positioned — one row, not keyed to a scene.",
  explicit: "Explicit — the row names the scene it applies to.",
  latest_wins:
    "Latest-wins (pattern 3) — the most recent row at or before a " +
    "position is in force.",
  sparse_persistence:
    "Sparse persistence (pattern 2) — in force from its keyed scene " +
    "onward, per its persistence field.",
};

const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

/** Who points at this entity, derived rather than declared. */
const inbound = new Map();
for (const e of entities) {
  for (const f of e.fields) {
    if (!f.referenceEntity) continue;
    if (!inbound.has(f.referenceEntity)) inbound.set(f.referenceEntity, []);
    inbound.get(f.referenceEntity).push(`${e.name}.${f.name}`);
  }
}

const lines = [
  "<!-- SPDX-License-Identifier: CC-BY-4.0 -->",
  "",
  "# Entity reference",
  "",
  `Schema **${registry.schemaVersion}** — **${entities.length} entities**.`,
  "",
  "**Generated from `registry.json`. Not normative, and not hand-edited.**",
  "`spec/scf-spec.md` states the rules; the registry states the field set.",
  "This document restates the second so a person can read it. Where it",
  "disagrees with either, they are right and this is a bug — file an issue.",
  "",
  "It does not explain what entities are *for*. Descriptions are the",
  "registry's own, and are as good as what is written there.",
  "",
  "## Every table carries these",
  "",
  "| Column | Type | |",
  "|---|---|---|",
  ...registry.frameworkColumns.map((c) =>
    `| \`${c.name}\` | \`${esc(c.sqlType)}\` | ${esc(c.$comment ?? "")} |`),
  "",
  "`id`, `created_at` and `updated_at` never appear in a query result",
  "(§12.1.2). `uuid` is the identity that travels between files (§6.1);",
  "`id` is file-local and means nothing outside the file it is in (§6.2).",
  "",
  "## Contents",
  "",
];

const tiers = [...new Set(entities.map((e) => e.tier))].sort((a, b) => a - b);
for (const tier of tiers) {
  const inTier = entities.filter((e) => e.tier === tier);
  lines.push(`- **Tier ${tier}** (${inTier.length}) — ${TIERS[tier] ?? ""}`);
}
lines.push("");

for (const tier of tiers) {
  const inTier = entities
    .filter((e) => e.tier === tier)
    .sort((a, b) => a.name.localeCompare(b.name));

  lines.push("---", "", `## Tier ${tier}`, "");
  if (TIERS[tier]) lines.push(`*${TIERS[tier]}*`, "");

  for (const e of inTier) {
    lines.push(`### \`${e.name}\``, "");
    if (e.description) lines.push(esc(e.description), "");

    const facts = [
      ["Label", `${e.label} / ${e.labelPlural}`],
      ["Category", e.category],
      ["Subject", e.subject],
      ["Scope", e.scope],
      ["Position", PATTERNS[e.positionPattern] ?? e.positionPattern],
      ["Name field", e.nameField ? `\`${e.nameField}\`` : "— none"],
    ];
    if (e.parentEntity) {
      facts.push(["Owned by",
                  `\`${e.parentEntity}\` via \`${e.parentField}\` — ` +
                  "deleting the parent deletes this row (§2.3)"]);
    }
    if (e.refines?.length) {
      facts.push(["Refines",
                  e.refines.map((r) => `\`${r}\``).join(", ") +
                  " — direction cascade, root first (§7)"]);
    }
    facts.push(["Versionable", e.versionable ? "yes" : "no"]);
    facts.push(["`lifecycle_status`",
                e.hasLifecycleStatus
                  ? "yes — a `cut` row appears in no result (§6.6.1)"
                  : "**no** — this entity cannot be marked cut"]);
    facts.push(["`external_id`", e.hasExternalId ? "yes (§6.3)" : "no"]);
    const back = inbound.get(e.name);
    if (back?.length) {
      facts.push([`Referenced by (${back.length})`,
                  back.map((r) => `\`${r}\``).join(", ")]);
    }

    lines.push("| | |", "|---|---|",
               ...facts.map(([k, v]) => `| ${k} | ${v} |`), "");

    const shown = e.fields.filter((f) => !f.hidden);
    if (shown.length === 0) {
      lines.push("*No authored fields — framework columns only.*", "");
      continue;
    }
    lines.push("| Field | Type | Req | |", "|---|---|---|---|");
    for (const f of shown) {
      const notes = [];
      if (f.referenceEntity) {
        notes.push(`→ \`${f.referenceEntity}\`` +
                   (f.name.endsWith("_id")
                     ? ` (resolves to \`${f.name.replace(/_id$/, "_uuid")}\`` +
                       " in a result, §12.1.2)"
                     : ""));
      }
      if (f.options?.length) {
        notes.push("one of " + f.options.map((o) => `\`${o}\``).join(", "));
      }
      if (f.default !== undefined && f.default !== null) {
        notes.push(`default \`${esc(f.default)}\``);
      }
      if (f.autoInjected) notes.push("auto-injected by the generator");
      if (f.helpText) notes.push(esc(f.helpText));
      lines.push(
        `| \`${f.name}\` | ${esc(f.fieldType)} | ` +
        `${f.required ? "**yes**" : ""} | ${notes.join(". ")} |`);
    }
    lines.push("");

    const hidden = e.fields.length - shown.length;
    if (hidden > 0) {
      lines.push(`*${hidden} hidden field(s) omitted — present in the ` +
                 "table, not offered for authoring.*", "");
    }
  }
}

lines.push("---", "",
           "Generated by `scf-core/scripts/emit_entity_reference.mjs`.", "");

const text = lines.join("\n");

if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(OUT, "utf8"); } catch { /* missing */ }
  if (current !== text) {
    console.error("[entity-reference.md] STALE — run: " +
                  "npm run emit-entity-reference");
    process.exit(1);
  }
  console.log(`[entity-reference.md] up to date ` +
              `(${entities.length} entities, schema ${registry.schemaVersion}).`);
} else {
  writeFileSync(OUT, text, "utf8");
  console.log(`[entity-reference.md] wrote ${entities.length} entities ` +
              `across ${tiers.length} tiers.`);
}
