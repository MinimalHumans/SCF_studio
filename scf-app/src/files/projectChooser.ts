// SPDX-License-Identifier: Apache-2.0
/**
 * projectChooser.ts — how the user names a `.scf`.
 *
 * The desktop shell implements these two methods with the operating
 * system's own dialogs (`nativeChooser.ts`), and nothing that calls
 * them knows that. Keeping it separate from `FileAdapter` is
 * deliberate: that adapter is only about the asset FOLDER, which still
 * has to come from the browser.
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
