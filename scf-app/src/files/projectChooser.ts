// SPDX-License-Identifier: Apache-2.0
/**
 * projectChooser.ts — how the user names a `.scf`: the OS's own Open
 * and Save dialogs (`files/tauriChooser.ts`), through this one
 * interface so nothing that calls it needs to know that.
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

/**
 * A file name that ends `.scf`, whatever the user typed — a native
 * save dialog does not always add the extension from its filter (GTK
 * does not).
 */
export function withScfExtension(name: string): string {
  const trimmed = name.trim();
  return /\.scf$/i.test(trimmed) ? trimmed : `${trimmed}.scf`;
}
