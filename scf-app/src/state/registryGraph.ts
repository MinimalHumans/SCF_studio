/**
 * registryGraph.ts — derived views over registry.json.
 *
 * The reference graph (which entity fields point at which entities) drives
 * reverse links ("what points here") and subject-oriented navigation —
 * generically, the way v1's _get_relationship_data was per-case. Nothing
 * here hand-defines an entity.
 */

import type { EntityDef, Registry } from "@scf-core/registry.ts";

export interface IncomingRef {
  fromEntity: string;
  field: string;
}

/** entityName -> fields elsewhere that reference it. */
export function buildReferenceGraph(
    registry: Registry): Map<string, IncomingRef[]> {
  const graph = new Map<string, IncomingRef[]>();
  for (const e of registry.entities.values()) {
    for (const f of e.fields) {
      if (f.fieldType === "reference" && f.referenceEntity !== undefined) {
        const list = graph.get(f.referenceEntity) ?? [];
        // Version-chain self references are lifecycle plumbing, not
        // subject-matter links.
        if (f.name === "parent_id" || f.name === "superseded_by_id") {
          continue;
        }
        list.push({ fromEntity: e.name, field: f.name });
        graph.set(f.referenceEntity, list);
      }
    }
  }
  return graph;
}

/** Categories in first-seen registry order, entities sorted per registry. */
export function entitiesByCategory(
    registry: Registry): Array<[string, EntityDef[]]> {
  const byCategory = new Map<string, EntityDef[]>();
  for (const name of registry.order) {
    const e = registry.entities.get(name);
    if (e === undefined) continue;
    const list = byCategory.get(e.category) ?? [];
    list.push(e);
    byCategory.set(e.category, list);
  }
  for (const list of byCategory.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder ||
                        a.label.localeCompare(b.label));
  }
  return [...byCategory.entries()];
}

/** Scope ordering for subject navigation: global -> moment. */
export const SCOPE_ORDER = ["global", "act", "sequence", "scene", "shot",
                            "moment"] as const;

export function scopeRank(scope: string | null): number {
  const i = SCOPE_ORDER.indexOf(
    (scope ?? "global") as typeof SCOPE_ORDER[number]);
  return i === -1 ? SCOPE_ORDER.length : i;
}

/** The subject values that can anchor subject navigation. */
export const NAVIGABLE_SUBJECTS = [
  "character", "location", "prop", "scene", "shot", "story", "theme",
  "project",
] as const;
export type NavigableSubject = typeof NAVIGABLE_SUBJECTS[number];
