// SPDX-License-Identifier: Apache-2.0
/**
 * RecentProjects.tsx — the start screen's history
 * (file-management-plan.md §3.5): every project `app.db` has seen,
 * most recently opened first. Missing files and missing asset roots
 * are marked, not hidden — the whole point of a history list is
 * seeing what is there before clicking it.
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ProjectRow } from "@scf-host/appStore.ts";
import { useStore } from "../state/store.ts";
import { windowAppStore } from "../host/windowAppStore.ts";

interface Entry extends ProjectRow {
  fileMissing: boolean;
  /** Null when there is no asset root to check. */
  rootMissing: boolean | null;
}

async function withExistence(row: ProjectRow): Promise<Entry> {
  const [fileMissing, rootMissing] = await Promise.all([
    invoke<boolean>("fs_exists", { path: row.scfPath }).then((e) => !e),
    row.assetRoot === null ? Promise.resolve(null)
      : invoke<boolean>("fs_exists", { path: row.assetRoot })
        .then((e) => !e),
  ]);
  return { ...row, fileMissing, rootMissing };
}

export function RecentProjects(): JSX.Element | null {
  const openRecentProject = useStore((s) => s.openRecentProject);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await (await windowAppStore()).recentProjects();
      const withChecks = await Promise.all(rows.map(withExistence));
      if (!cancelled) setEntries(withChecks);
    })();
    return () => { cancelled = true; };
  }, [epoch]);

  const forget = (path: string): void => {
    void (async () => {
      await (await windowAppStore()).forgetProject(path);
      setEpoch((e) => e + 1);
    })();
  };

  const clearHistory = (): void => {
    void (async () => {
      const store = await windowAppStore();
      await Promise.all(
        (entries ?? []).map((e) => store.forgetProject(e.scfPath)));
      setEpoch((e) => e + 1);
    })();
  };

  if (entries === null || entries.length === 0) return null;

  return (
    <div className="recent-projects">
      <h2 className="recent-projects-title">Recent projects</h2>
      <ul>
        {entries.map((e) => (
          <li key={e.pathKey} className="recent-project-row">
            <button className="ghost recent-project-open"
                    disabled={e.fileMissing}
                    onClick={() => void openRecentProject(e.scfPath)}>
              <strong>{e.title ?? e.baseName ?? "Untitled"}</strong>
              <span className="muted small">{e.scfPath}</span>
              {e.fileMissing && (
                <span className="recent-project-flag">file not found</span>
              )}
              {!e.fileMissing && e.assetRoot !== null && (
                <span className="muted small">
                  {e.assetRoot}
                  {e.rootMissing === true && (
                    <span className="recent-project-flag">
                      {" "}folder not found
                    </span>
                  )}
                </span>
              )}
            </button>
            <button className="ghost tiny" title="Forget this entry"
                    onClick={() => forget(e.scfPath)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <button className="ghost tiny" onClick={clearHistory}>
        Clear history
      </button>
    </div>
  );
}
