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
const REMEMBER_TABS_PREF = "rememberOpenTabs";
/** Where the open-tab list itself is kept (projectTabs.ts, written by
 *  store.ts); named here because turning this setting off also clears
 *  it. */
export const OPEN_TABS_PREF = "openTabs";

interface SettingsState {
  /** False until `load` has returned once. */
  loaded: boolean;
  /** Developer-only tools (the row identity inspector); off by default. */
  developerMode: boolean;
  /** Reopen every tab that was open last time, on by default. */
  rememberTabs: boolean;
  load(): Promise<void>;
  setDeveloperMode(on: boolean): Promise<void>;
  setRememberTabs(on: boolean): Promise<void>;
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
  // Optimistic default: correct for everyone who has never touched the
  // setting, and overwritten by the real value the moment `load` returns
  // — so a tab opened in the instant before that happens is still worth
  // remembering rather than assumed throwaway.
  rememberTabs: true,

  load: async () => {
    const store = await windowAppStore();
    const [developerMode, rememberTabs] = await Promise.all([
      store.getPref(DEVELOPER_MODE_PREF), store.getPref(REMEMBER_TABS_PREF),
    ]);
    set({ developerMode: developerMode === "1",
          rememberTabs: rememberTabs === null ? true : rememberTabs === "1",
          loaded: true });
  },

  setDeveloperMode: async (on) => {
    const store = await windowAppStore();
    await store.setPref(DEVELOPER_MODE_PREF, on ? "1" : "0");
    set({ developerMode: on });
    await logSettingsChange(
      "settings.developerMode", on ? "turned on" : "turned off");
  },

  setRememberTabs: async (on) => {
    const store = await windowAppStore();
    await store.setPref(REMEMBER_TABS_PREF, on ? "1" : "0");
    // Turning it off forgets what was open, too — otherwise flipping it
    // back on later would resurrect a stale list nobody asked to keep.
    if (!on) await store.setPref(OPEN_TABS_PREF, "");
    set({ rememberTabs: on });
    await logSettingsChange(
      "settings.rememberTabs", on ? "turned on" : "turned off");
  },
}));
