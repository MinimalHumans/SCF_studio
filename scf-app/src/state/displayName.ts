/**
 * displayName.ts — what a row is CALLED on screen, in one place.
 *
 * Two rules the registry already implies but nothing acted on:
 *
 *  1. Scenes are identified by number, not by heading. Imported scripts
 *     repeat headings freely (three INT. KITCHEN - DAY in an act is
 *     normal), so the heading alone is not an identity. Everything that
 *     lists or picks a scene goes through `sceneLabel`.
 *
 *  2. A link row has no name of its own. All but one of 2.3's thirteen
 *     `subject: "link"` entities declare their name field `hidden: true`
 *     — the schema is saying "not user-facing" — and the importer parks
 *     the cue text there, which is why a character's Scene-Characters
 *     list read as that character's name thirty times over. Their label
 *     is composed from the rows they point AT, resolved at render time.
 *     Composing beats denormalizing a good string into the column at
 *     import: renaming a scene would strand every copy, and existing
 *     files (hollow_creek's numeric names) would stay unreadable.
 */

import type { Row } from "@scf-core/db.ts";
import type { EntityDef, FieldDef } from "@scf-core/registry.ts";

/** Resolves a reference to the label of the row it points at. */
export type NameLookup =
  (entity: string, id: unknown) => string | null;

const text = (v: unknown): string =>
  v === null || v === undefined ? "" : String(v);

/**
 * `sc 12 — INT. KITCHEN`. An unnumbered scene keeps its heading and says
 * so rather than silently looking like scene zero — imported scripts
 * often carry headings the parser could not number.
 */
export function sceneLabel(scene: Row | null | undefined): string {
  if (scene === null || scene === undefined) return "";
  const number = scene["scene_number"];
  const heading = text(scene["name"]);
  const id = text(scene["id"]);
  // A row fetched without the column is not an unnumbered scene — it is
  // a row we cannot say anything about. Saying "unnumbered" there turned
  // every scene in the subject rail into one.
  if (!("scene_number" in scene)) {
    return heading === "" ? `scene #${id}` : heading;
  }
  if (number === null || number === undefined || text(number) === "") {
    return heading === "" ? `scene #${id}` : `unnumbered — ${heading}`;
  }
  return heading === ""
    ? `sc ${text(number)}` : `sc ${text(number)} — ${heading}`;
}

/** Short form for tight spots (spine tooltips, row suffixes). */
export function sceneShort(scene: Row | null | undefined): string {
  if (scene === null || scene === undefined) return "";
  const number = scene["scene_number"];
  return number === null || number === undefined || text(number) === ""
    ? "unplaced" : `sc ${text(number)}`;
}

/** True when the row's own name column is not meant to be shown. */
export function isComposedLink(edef: EntityDef | undefined): boolean {
  if (edef === undefined) return false;
  const field = edef.fields.find((f) => f.name === edef.nameField);
  return edef.subject === "link" && field?.hidden === true;
}

export function referenceFields(edef: EntityDef): FieldDef[] {
  return edef.fields.filter((f) =>
    f.fieldType === "reference" && f.referenceEntity !== undefined);
}

/**
 * The label for a row of `edef`, without resolving references.
 * Scene-aware; everything else is its name field, then a typed fallback.
 */
/**
 * `1C — WIDE`, or `1C` alone. A shot's identity is its number: the
 * name field is a description and is routinely empty, which is why
 * shot lists read as "Shot #3" while the row itself said 1C.
 */
export function shotLabel(row: Row): string {
  const number = text(row["shot_number"]);
  const name = text(row["name"]);
  if (number === "" && name === "") return `shot #${text(row["id"])}`;
  if (number === "") return name;
  return name === "" ? number : `${number} — ${name}`;
}

export function rowLabel(edef: EntityDef | undefined, entity: string,
                         row: Row): string {
  if (entity === "scene") return sceneLabel(row);
  if (entity === "shot" && "shot_number" in row) return shotLabel(row);
  // A hidden name column is not a name. The importer parks cue text
  // there; showing it is the bug this module exists to fix, so it never
  // reaches the screen. Callers that can resolve references go through
  // `linkLabel` and only land here while those labels load.
  if (!isComposedLink(edef)) {
    const v = row[edef?.nameField ?? "name"];
    if (v !== null && v !== undefined && v !== "") return String(v);
  }
  return `${edef?.label ?? entity} #${text(row["id"])}`;
}

/**
 * A link row's label: the ends it points at, resolved.
 *
 * `omitField` drops the end you are already looking from — in Alexis's
 * Scene-Characters list every row's character end is Alexis, so naming
 * it thirty times says nothing. With no anchor (the Schema tab) both
 * ends show: `sc 1 — EXT. MONUMENT VALLEY · ALEXIS`.
 *
 * Returns null when nothing resolves yet (lookups load asynchronously),
 * so callers can fall back rather than flash an empty row.
 */
export function linkLabel(edef: EntityDef, row: Row, lookup: NameLookup,
                          omitField?: string): string | null {
  const parts = referenceFields(edef)
    .filter((f) => f.name !== omitField)
    .map((f) => lookup(f.referenceEntity as string, row[f.name]))
    .filter((s): s is string => s !== null && s !== "");
  return parts.length === 0 ? null : parts.join(" · ");
}

/**
 * The qualifiers that ride to the right of a link label — the row's own
 * authored detail, which is the part that actually differs between two
 * links to the same pair. Selects only: free text and notes belong on
 * the row's page, not in a list.
 */
export function linkQualifiers(edef: EntityDef, row: Row): string[] {
  return edef.fields
    .filter((f) => f.fieldType === "select" && f.hidden !== true)
    .map((f) => text(row[f.name]))
    .filter((v) => v !== "");
}
