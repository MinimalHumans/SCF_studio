// SPDX-License-Identifier: Apache-2.0
/**
 * settings.ts — app-wide settings, kept in `app.db`'s `pref` table
 * (scf-host `appStore.ts`) rather than browser storage: they are not
 * tied to one project, and `app.db` is already shared with the
 * standalone MCP, so a setting changed here is seen there too.
 *
 * Per-project settings (the asset root pairing) stay where they are,
 * in the `project` table — this store is only for the rest.
 */

import { create } from "zustand";
import { windowAppStore } from "../host/windowAppStore.ts";
import { windowAuditStore } from "../host/windowAuditStore.ts";

const DEVELOPER_MODE_PREF = "developerMode";

interface SettingsState {
  /** False until `load` has returned once. */
  loaded: boolean;
  /** Developer-only tools (the row identity inspector); off by default. */
  developerMode: boolean;
  load(): Promise<void>;
  setDeveloperMode(on: boolean): Promise<void>;
}

/** A settings change is app-scope, not a project write, so it is
 *  appended directly rather than through the host's write path. */
async function logSettingsChange(action: string, summary: string):
    Promise<void> {
  const store = await windowAuditStore().catch(() => null);
  await store?.append({
    actorKind: "user", actorName: "window", scope: "app", action, summary,
  }).catch((e: unknown) => { console.error("audit trail write failed:", e); });
}

export const useSettings = create<SettingsState>((set) => ({
  loaded: false,
  developerMode: false,

  load: async () => {
    const store = await windowAppStore();
    const value = await store.getPref(DEVELOPER_MODE_PREF);
    set({ developerMode: value === "1", loaded: true });
  },

  setDeveloperMode: async (on) => {
    const store = await windowAppStore();
    await store.setPref(DEVELOPER_MODE_PREF, on ? "1" : "0");
    set({ developerMode: on });
    await logSettingsChange(
      "settings.developerMode", on ? "turned on" : "turned off");
  },
}));
