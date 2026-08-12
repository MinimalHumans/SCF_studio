/**
 * assetImport.ts — creating many asset rows at once.
 *
 * Authoring assets one form at a time does not survive contact with a
 * real project: a sequence folder holds hundreds of plates, and nobody
 * is going to type four hundred identifiers.
 *
 * This is still read-only toward the filesystem (conventions §9).
 * Import READS a set of files the user picked and writes rows into the
 * .scf. Nothing is copied, moved, or created on disk, and the files
 * stay exactly where they were — what lands in the database is an
 * address, not a payload.
 *
 * The planner is pure and the caller supplies the candidates, so how
 * the files were chosen — a multi-select picker, a directory walk, a
 * paste — is not this module's business. That separation matters more
 * than usual here: directory ENUMERATION is not available on every
 * machine (§9), so the picker path has to work without it.
 */

import { newUuid, q, type SqlExec } from "./db.ts";
import { normalisePath, parseIdentifier } from "./assets.ts";

export interface ImportCandidate {
  /** Rooted identifier, e.g. `@project/assets/plates/sh010_v3.exr`. */
  identifier: string;
  /** Display name. Defaults to the last path segment. */
  name?: string;
  sizeBytes?: number | null;
  mtime?: string | null;
}

export interface ImportPlan {
  /** Candidates that would become new rows. */
  create: ImportCandidate[];
  /** Candidates whose identifier is already in the file, with the row. */
  existing: { identifier: string; id: number }[];
  /** Candidates rejected before any lookup, with the reason. */
  rejected: { identifier: string; reason: string }[];
}

/** Last path segment, which is what a person would call the file. */
export function nameFromIdentifier(identifier: string): string {
  const parsed = parseIdentifier(identifier);
  const path = parsed?.path ?? identifier;
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

/**
 * Decide what an import would do, without doing it.
 *
 * Identifier is the identity here, not the filename: two files called
 * `plate.exr` in different folders are two assets, and the same file
 * offered twice is one. Re-importing a folder after adding three files
 * should therefore create three rows and not touch the rest, which is
 * what makes import safe to run repeatedly.
 */
export async function planAssetImport(
  exec: SqlExec, candidates: readonly ImportCandidate[],
): Promise<ImportPlan> {
  const plan: ImportPlan = { create: [], existing: [], rejected: [] };

  const rows = await exec(
    `SELECT id, identifier FROM ${q("asset")} ` +
    `WHERE identifier IS NOT NULL AND identifier <> ''`);
  const known = new Map<string, number>();
  for (const row of rows) {
    known.set(String(row["identifier"]), Number(row["id"]));
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    const identifier = candidate.identifier.trim();
    if (parseIdentifier(identifier) === null) {
      plan.rejected.push({ identifier, reason: "not a usable identifier" });
      continue;
    }
    if (seen.has(identifier)) continue;   // same file offered twice
    seen.add(identifier);

    const hit = known.get(identifier);
    if (hit !== undefined) {
      plan.existing.push({ identifier, id: hit });
      continue;
    }
    plan.create.push(candidate);
  }
  return plan;
}

/**
 * Write the planned rows.
 *
 * Size and mtime are stored as the staleness hints they are; no hash is
 * computed, because hashing a folder's worth of files on import would
 * stall on anything unmaterialised and is a deliberate per-asset act.
 */
export async function applyAssetImport(
  exec: SqlExec, candidates: readonly ImportCandidate[],
): Promise<number> {
  let created = 0;
  for (const candidate of candidates) {
    await exec(
      `INSERT INTO ${q("asset")} ` +
      `(name, uuid, identifier, size_bytes, source_mtime) ` +
      `VALUES (?, ?, ?, ?, ?)`,
      [candidate.name ?? nameFromIdentifier(candidate.identifier),
       newUuid(), candidate.identifier,
       candidate.sizeBytes ?? null, candidate.mtime ?? null]);
    created += 1;
  }
  return created;
}


/**
 * Where a dropped or picked folder sits under the project root.
 *
 * A directory input reports paths anchored at the folder the user
 * picked, not at the project: picking `assets` yields
 * `assets/test.png`, picking the project itself yields
 * `AlexisNexus/assets/test.png`. Nothing in the FileList says which
 * happened, and a `File` carries no handle, so `resolve()` is not
 * available to ask.
 *
 * So: produce the candidates in the order worth trying, and let the
 * caller settle it by TRAVERSAL — walking the root to see which one is
 * actually there. That is the capability available on every machine we
 * have seen, including the one where enumeration returns nothing.
 *
 * Order matters. The stripped form is tried first when the leading
 * segment matches the root's folder name, because picking the project
 * folder is the common gesture and `AlexisNexus/assets/x.png` under a
 * root already called AlexisNexus would be wrong.
 */
export function candidatePaths(
  relativePath: string, rootName: string | null,
): string[] {
  const path = normalisePath(relativePath);
  if (path === "") return [];

  const slash = path.indexOf("/");
  const head = slash === -1 ? path : path.slice(0, slash);
  const tail = slash === -1 ? "" : path.slice(slash + 1);

  const out: string[] = [];
  if (tail !== "" && rootName !== null && head === rootName) {
    out.push(tail);      // the user picked the project folder itself
  }
  out.push(path);        // the user picked a folder at the root
  if (tail !== "" && !out.includes(tail)) {
    out.push(tail);      // fallback: leading segment is some other anchor
  }
  return out;
}
