// SPDX-License-Identifier: Apache-2.0
/**
 * projectChooser.ts — how the user names a `.scf`.
 *
 * A browser cannot hand the host a file path, so until there is a
 * native dialog the host lists folders for the page to show. That is
 * ONE implementation of this interface; a desktop shell implements the
 * same two methods with the operating system's own dialogs and nothing
 * that calls them changes. Keeping it separate from `FileAdapter` is
 * deliberate: that adapter is now only about the asset FOLDER, which
 * still has to come from the browser.
 */

export interface ProjectChooser {
  /** Pick an existing `.scf`. The host's path for it, or null on cancel. */
  chooseExisting(): Promise<string | null>;
  /**
   * Pick where a new `.scf` goes. `suggestedName` is a file name such
   * as "Untitled.scf". The full path, or null on cancel.
   */
  chooseNew(suggestedName: string): Promise<string | null>;
}

// ── the browsing model, with no UI in it ───────────────────────────

export interface ChooserEntry {
  name: string;
  kind: "dir" | "scf";
  path: string;
}

export interface Listing {
  path: string | null;
  parent: string | null;
  entries: ChooserEntry[];
}

export type ChooserMode = "open" | "new";

export interface ChooserState {
  mode: ChooserMode;
  listing: Listing | null;
  error: string | null;
  /** The file name being typed (new) or the entry selected (open). */
  name: string;
  /** What Confirm would return, or null when it is not yet valid. */
  result: string | null;
}

/** Join a folder and a name with the folder's own separator. */
export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

/** A file name that ends `.scf`, whatever the user typed. */
export function withScfExtension(name: string): string {
  const trimmed = name.trim();
  return /\.scf$/i.test(trimmed) ? trimmed : `${trimmed}.scf`;
}

/** Names the host would reject or that name no file. */
export function badFileName(name: string): string | null {
  const n = name.trim();
  if (n === "" || n === ".scf") return "Give the file a name.";
  if (/[\\/:*?"<>|\0]/.test(n)) {
    return "A file name cannot contain \\ / : * ? \" < > |";
  }
  if (n === "." || n === "..") return "That is not a file name.";
  return null;
}

export function chooserResult(
    mode: ChooserMode, listing: Listing | null, name: string,
    existing: ReadonlySet<string>): string | null {
  if (listing === null || listing.path === null) return null;
  if (mode === "open") {
    return listing.entries.find((e) => e.kind === "scf" && e.name === name)
      ?.path ?? null;
  }
  if (badFileName(name) !== null) return null;
  const file = withScfExtension(name);
  if (existing.has(file.toLowerCase())) return null;
  return joinPath(listing.path, file);
}
