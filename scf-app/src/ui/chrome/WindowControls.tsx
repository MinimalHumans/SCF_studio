// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Whether this window drew no frame of its own, so the strip has to
 * provide minimize, maximize and close. Asked of the window rather than
 * the OS: the shell decides that (`lib.rs`), and a platform that keeps
 * its native frame needs nothing here.
 */
export function useFrameless(): boolean {
  const [frameless, setFrameless] = useState(false);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let live = true;
    void getCurrentWindow().isDecorated().then((decorated) => {
      if (live) setFrameless(!decorated);
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  return frameless;
}

export function WindowControls(): JSX.Element {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let live = true;
    const sync = (): void => {
      void win.isMaximized().then((m) => { if (live) setMaximized(m); })
        .catch(() => undefined);
    };
    sync();
    const off = win.onResized(sync);
    return () => {
      live = false;
      void off.then((f) => { f(); });
    };
  }, []);

  const win = getCurrentWindow();
  return (
    <div className="window-controls">
      <button className="window-control" aria-label="Minimize"
              title="Minimize" onClick={() => void win.minimize()}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5h10" stroke="currentColor" fill="none" />
        </svg>
      </button>
      <button className="window-control"
              aria-label={maximized ? "Restore" : "Maximize"}
              title={maximized ? "Restore" : "Maximize"}
              onClick={() => void win.toggleMaximize()}>
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 2.5v-2h7v7h-2M.5 2.5h7v7h-7z"
                  stroke="currentColor" fill="none" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M.5.5h9v9h-9z" stroke="currentColor" fill="none" />
          </svg>
        )}
      </button>
      <button className="window-control window-control-close"
              aria-label="Close" title="Close"
              onClick={() => void win.close()}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" fill="none" />
        </svg>
      </button>
    </div>
  );
}
