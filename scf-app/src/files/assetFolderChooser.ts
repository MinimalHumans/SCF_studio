// SPDX-License-Identifier: Apache-2.0
/**
 * assetFolderChooser.ts — the native "choose asset folder" dialog
 * (file-management-plan.md §3.3), for a project's asset root.
 *
 * Starts in the `lastAssetFolder` pref (`app.db`, scf-host
 * `appStore.ts`, shared through `windowAppStore.ts`) and updates it
 * after a successful pick.
 */

import { open } from "@tauri-apps/plugin-dialog";
import { windowAppStore } from "../host/windowAppStore.ts";

const LAST_ASSET_FOLDER = "lastAssetFolder";

export async function chooseAssetFolder(): Promise<string | null> {
  const store = await windowAppStore();
  const path = await open({
    multiple: false, directory: true,
    defaultPath: (await store.getPref(LAST_ASSET_FOLDER)) ?? undefined,
  });
  if (path === null) return null;
  await store.setPref(LAST_ASSET_FOLDER, path);
  return path;
}
