// SPDX-License-Identifier: Apache-2.0
/**
 * nativeChooser.ts — the operating system's own dialogs, as a
 * `ProjectChooser`.
 *
 * The shell's dialog plugin returns a plain path, which is what the
 * host opens by. Opening is allowed anywhere the dialog can reach; a
 * new file still has to land under the host's roots, and the host says
 * so if it does not.
 */

import { open, save } from "@tauri-apps/plugin-dialog";
import type { ProjectChooser } from "./projectChooser.ts";
import { joinPath, withScfExtension } from "./projectChooser.ts";

const SCF = [{ name: "SCF film", extensions: ["scf"] }];

/** Where the last dialog was, so the next one starts there. */
let lastFolder: string | undefined;
const remember = (path: string): string => {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  if (cut > 0) lastFolder = path.slice(0, cut);
  return path;
};

export function createNativeChooser(): ProjectChooser {
  return {
    chooseExisting: async () => {
      const path = await open({
        multiple: false, directory: false, filters: SCF,
        ...(lastFolder === undefined ? {} : { defaultPath: lastFolder }),
      });
      return path === null ? null : remember(path);
    },
    chooseNew: async (suggestedName) => {
      const path = await save({
        filters: SCF,
        defaultPath: lastFolder === undefined
          ? suggestedName : joinPath(lastFolder, suggestedName),
      });
      // Some platforms' save dialogs drop an extension the user deleted.
      return path === null ? null : remember(withScfExtension(path));
    },
  };
}
