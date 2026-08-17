/**
 * assets.ts — addressing, and what resolution says when it fails.
 *
 * P3 of the assets plan; the rules are conventions §9.
 *
 * An asset row stores an IDENTIFIER, not a location: a rooted,
 * relocatable address that gets committed and diffed. A RESOLVER maps
 * it to bytes. What comes back is derived and never stored, which is
 * what turns relocating a project into a change to one root rather than
 * an update across thousands of rows.
 *
 * The module knows nothing about a browser. It takes a `FileLocator` —
 * anything that can answer "is there something at this path, and how
 * big is it" — so the grammar and the state machine are testable
 * without a directory handle, and the adapter above supplies the I/O.
 *
 * Absence is total and typed. `missing` and `unmaterialised` are
 * different facts: a cloud placeholder is a file that will appear when
 * touched, and reporting a synced project as broken on open would be a
 * false statement about the user's data.
 */

import { q, type SqlExec } from "./db.ts";

export const PROJECT_ROOT = "project";

export type ResolutionState =
  | "resolved"
  | "missing"
  | "unmaterialised"
  | "out-of-root"
  | "unaddressed";

export interface AssetIdentifier {
  /** Root name without the `@`, or null for an absolute path. */
  root: string | null;
  /** Path below the root, normalised, no leading slash. */
  path: string;
  /** True for an absolute or drive-lettered path: representable, not
   *  portable, and always reported as such. */
  absolute: boolean;
  /** The text as stored. */
  raw: string;
}

const DRIVE = /^[a-zA-Z]:[\\/]/;

/**
 * Parse a stored identifier.
 *
 * Anything that is not `@root/...` is treated as absolute rather than
 * silently adopted into `@project`: guessing that a bare path is
 * project-relative would put a lie in the portable namespace, and the
 * one thing a root is for is being explicit.
 */
export function parseIdentifier(raw: string): AssetIdentifier | null {
  const text = raw.trim();
  if (text === "") return null;

  if (text.startsWith("@")) {
    // Separators are normalised before the root is split, or a Windows
    // path pasted under a root would swallow the whole thing as a root
    // name. `raw` keeps what was stored.
    const unified = text.replace(/\\/g, "/");
    const slash = unified.indexOf("/");
    const root = slash === -1 ? unified.slice(1) : unified.slice(1, slash);
    if (root === "") return null;
    const path = slash === -1 ? "" : normalisePath(unified.slice(slash + 1));
    return { root, path, absolute: false, raw: text };
  }

  const absolute = text.startsWith("/") || DRIVE.test(text) ||
    /^[a-z]+:\/\//i.test(text);
  return { root: null, path: normalisePath(text), absolute, raw: text };
}

/** Collapse separators and strip `.` segments. `..` is refused. */
export function normalisePath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/")
    .filter((p) => p !== "" && p !== ".");
  return parts.join("/");
}

/** True when the identifier escapes its root. Never resolved. */
export function escapesRoot(path: string): boolean {
  return path.replace(/\\/g, "/").split("/").includes("..");
}

/** Build the identifier for a path below the project root. */
export function projectIdentifier(path: string): string {
  return `@${PROJECT_ROOT}/${normalisePath(path)}`;
}

/**
 * The format hint, derived from the identifier and nothing else.
 *
 * A hint, never a claim about purpose: the same `.txt` serves twenty
 * purposes across a production, and what an asset is FOR lives on the
 * link that reaches it (conventions §9).
 */
export function formatOf(identifier: string): string | null {
  const path = identifier.split("?")[0] ?? identifier;
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

/** What a locator reports about one path. */
export interface LocatedFile {
  /** False for a cloud placeholder that has not been materialised. */
  materialised: boolean;
  sizeBytes: number | null;
  mtime: string | null;
}

/**
 * The I/O seam. Returns null when nothing is there.
 *
 * `root` is the root name (`project`, `plates`); `path` is below it.
 * An implementation that does not know a root returns undefined so the
 * caller can distinguish "no such root" from "no such file".
 */
export type FileLocator = (
  root: string | null, path: string,
) => Promise<LocatedFile | null | undefined>;

export interface Resolution {
  identifier: AssetIdentifier | null;
  state: ResolutionState;
  format: string | null;
  sizeBytes: number | null;
  mtime: string | null;
  /** One sentence, safe to show. Null when resolved. */
  detail: string | null;
}

export async function resolveIdentifier(
  raw: string | null, locate: FileLocator,
): Promise<Resolution> {
  const empty: Resolution = {
    identifier: null, state: "unaddressed", format: null,
    sizeBytes: null, mtime: null,
    detail: "this asset has no identifier, so there is nothing to resolve",
  };
  if (raw === null) return empty;

  const identifier = parseIdentifier(raw);
  if (identifier === null) return empty;

  const format = formatOf(identifier.raw);
  const base = { identifier, format, sizeBytes: null, mtime: null };

  if (escapesRoot(identifier.path)) {
    return { ...base, state: "out-of-root",
             detail: "the identifier climbs above its root with '..', " +
                     "which is never resolved" };
  }


  if (identifier.absolute) {
    return { ...base, state: "out-of-root",
             detail: "an absolute path resolves on this machine and " +
                     "nowhere else — it will not travel with the project" };
  }

  const found = await locate(identifier.root, identifier.path);

  if (found === undefined) {
    // `unaddressed`, not `out-of-root` — spec §8.3. The identifier is
    // fine and may well be portable; this session simply has nowhere to
    // resolve it against. Reporting it as out-of-root told a user their
    // paths were wrong when the truth was that no project folder was
    // attached, and it made every asset in a lone .scf look broken.
    return { ...base, state: "unaddressed",
             detail: `no root named @${identifier.root ?? "?"} is ` +
                     `configured in this session` };
  }
  if (found === null) {
    return { ...base, state: "missing",
             detail: `nothing at @${identifier.root ?? ""}/` +
                     `${identifier.path}` };
  }
  if (!found.materialised) {
    return { ...base, state: "unmaterialised",
             sizeBytes: found.sizeBytes, mtime: found.mtime,
             detail: "the file is a placeholder that has not been " +
                     "downloaded — it is not missing, and will appear " +
                     "when something opens it" };
  }
  return { identifier, state: "resolved", format,
           sizeBytes: found.sizeBytes, mtime: found.mtime, detail: null };
}

export interface AssetResolution extends Resolution {
  id: number;
  name: string | null;
}

export interface ResolutionReport {
  assets: AssetResolution[];
  counts: Record<ResolutionState, number>;
  total: number;
}

const EMPTY_COUNTS = (): Record<ResolutionState, number> => ({
  resolved: 0, missing: 0, unmaterialised: 0, "out-of-root": 0,
  unaddressed: 0,
});

/**
 * Resolve every asset in the file.
 *
 * Total on half-placed data: a project where nothing resolves reports
 * every state and throws nothing, because a session with no folder
 * attached is a normal state and not an error (conventions §9).
 */
export async function resolveAllAssets(
  exec: SqlExec, locate: FileLocator,
): Promise<ResolutionReport> {
  const rows = await exec(
    `SELECT id, name, identifier FROM ${q("asset")} ORDER BY id`);
  const assets: AssetResolution[] = [];
  const counts = EMPTY_COUNTS();

  for (const row of rows) {
    const stored = row["identifier"];
    const raw = stored === null || stored === undefined || stored === ""
      ? null : String(stored);
    const resolution = await resolveIdentifier(raw, locate);
    counts[resolution.state] += 1;
    assets.push({
      ...resolution,
      id: Number(row["id"]),
      name: row["name"] === null || row["name"] === undefined
        ? null : String(row["name"]),
    });
  }

  return { assets, counts, total: rows.length };
}

/**
 * Re-root a run of identifiers in one move.
 *
 * Bulk re-rooting is the common repair — a folder moved, a share got a
 * new name — and per-asset relinking is the fallback for the odd one
 * out. Returns the rows it would change, or changes them: a repair that
 * cannot be previewed is one nobody will trust on a thousand rows.
 */
export interface RelinkChange {
  id: number;
  from: string;
  to: string;
}

export async function planRelink(
  exec: SqlExec, fromPrefix: string, toPrefix: string,
): Promise<RelinkChange[]> {
  if (fromPrefix === "") return [];
  const rows = await exec(
    `SELECT id, identifier FROM ${q("asset")} ` +
    `WHERE identifier IS NOT NULL AND identifier <> ''`);
  const changes: RelinkChange[] = [];
  for (const row of rows) {
    const current = String(row["identifier"]);
    if (!current.startsWith(fromPrefix)) continue;
    const next = toPrefix + current.slice(fromPrefix.length);
    if (next === current) continue;
    changes.push({ id: Number(row["id"]), from: current, to: next });
  }
  return changes;
}

export async function applyRelink(
  exec: SqlExec, changes: readonly RelinkChange[],
): Promise<number> {
  for (const change of changes) {
    await exec(`UPDATE ${q("asset")} SET identifier = ? WHERE id = ?`,
               [change.to, change.id]);
  }
  return changes.length;
}
