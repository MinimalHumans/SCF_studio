// SPDX-License-Identifier: Apache-2.0
/**
 * naturalKey.ts — label → uuid, for callers that only have a label.
 *
 * An agent handed the string "10A" or "Eleanor" has exactly the problem
 * `fixtures/expectations/selectors.json` exists to solve for the seven
 * rows the conformance suite names by hand (spec/scf-mcp-design.md §3):
 * it needs a row's uuid and has nothing but a label to find it with.
 *
 * §6.3's "natural key" and `junctionKeyFields` cover the thirteen
 * `subject: "link"` entities — the columns that make two junction rows
 * the same relationship. That is a different problem from resolving a
 * typed label to a row, and it does not help here: `scene` and `shot`,
 * the motivating cases, are not links.
 *
 * There is no registry-declared "this is the label field" marker for a
 * scalar entity. The rule below is inferred from the data, not
 * published by the format: if the entity declares a field named
 * `<entity>_number` (true for act, sequence, scene, take, shot), that
 * field is the label; otherwise the entity's `nameField` is. It is the
 * same convention every existing hand-written lookup in this tree
 * already assumes (test/setup.ts's sceneByNumber, scf-app's
 * displayName.ts/useRefNames.ts) — this just states it once, from the
 * registry, instead of re-deriving it per call site.
 */

import { q, type SqlValue } from "./db.ts";
import { rows, type ScfContext } from "./resolution.ts";

export interface KeyHit {
  uuid: string;
  entity: string;
  /** The matched field's stored value — may differ in case from the query. */
  label: string;
}

function labelField(ctx: ScfContext, entityType: string): string {
  const edef = ctx.registry.entities.get(entityType);
  if (edef === undefined) {
    throw new Error(`resolveNaturalKey: unknown entity type "${entityType}"`);
  }
  if (edef.subject === "link") {
    throw new Error(
      `resolveNaturalKey: "${entityType}" is a junction entity (§6.3) ` +
      "with no typed label — resolve it through the rows it links " +
      "instead.");
  }
  const numberField = `${entityType}_number`;
  return edef.fields.some((f) => f.name === numberField)
    ? numberField : edef.nameField;
}

/**
 * Resolve a natural-key label to every matching row.
 *
 * Returns an array, always — including when exactly one row matches.
 * §6.4 says duplicates MUST be reported as findings, never rejected; a
 * signature returning a single hit or null would let a caller forget
 * that rule, and one returning an array cannot.
 */
export async function resolveNaturalKey(
    ctx: ScfContext, entityType: string, label: string,
): Promise<KeyHit[]> {
  const needle = label.trim();
  if (needle === "") return [];

  const field = labelField(ctx, entityType);
  const found = await rows(ctx.exec, entityType,
    `${q(field)} = ? COLLATE NOCASE`, [needle as SqlValue]);

  return found.map((r) => ({
    uuid: String(r["uuid"]),
    entity: entityType,
    label: String(r[field]),
  }));
}
