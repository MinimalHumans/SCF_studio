// SPDX-License-Identifier: Apache-2.0
/**
 * tauriChooser.ts — `ProjectChooser` (`projectChooser.ts`) over the
 * shell's native file dialogs (tauri-plugin-dialog), so opening and
 * saving a `.scf` use the OS's own Open/Save dialogs: any drive,
 * network location or UNC path (file-management-plan.md §3.3).
 *
 * Each dialog starts in the `lastProjectFolder` pref (`app.db`,
 * scf-host `appStore.ts`, shared through `windowAppStore.ts`) and
 * updates it after a successful pick.
 */

import { open, save } from "@tauri-apps/plugin-dialog";
import { windowAppStore } from "../host/windowAppStore.ts";
import {
  joinPath, withScfExtension, type ProjectChooser,
} from "./projectChooser.ts";

const FILTERS = [{ name: "SCF project", extensions: ["scf"] }];
const LAST_PROJECT_FOLDER = "lastProjectFolder";

/** The folder half of a path, by whichever separator it uses. */
function dirnameOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut <= 0 ? path : path.slice(0, cut);
}

export function createTauriChooser(): ProjectChooser {
  return {
    async chooseExisting() {
      const store = await windowAppStore();
      const path = await open({
        multiple: false, directory: false, filters: FILTERS,
        defaultPath: (await store.getPref(LAST_PROJECT_FOLDER)) ?? undefined,
      });
      if (path === null) return null;
      await store.setPref(LAST_PROJECT_FOLDER, dirnameOf(path));
      return path;
    },

    async chooseNew(suggestedName) {
      const store = await windowAppStore();
      const folder = await store.getPref(LAST_PROJECT_FOLDER);
      const picked = await save({
        filters: FILTERS,
        defaultPath: folder === null
          ? suggestedName : joinPath(folder, suggestedName),
      });
      if (picked === null) return null;
      const path = withScfExtension(picked);
      await store.setPref(LAST_PROJECT_FOLDER, dirnameOf(path));
      return path;
    },
  };
}
