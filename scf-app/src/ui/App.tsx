// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef } from "react";
import { useStore } from "../state/store.ts";
import { Workbench } from "./Workbench.tsx";

function StartScreen(): JSX.Element {
  const { openDemo, openFromPicker, openProjectFolder, newProject,
          resumeLast, lastSession, fsAccessSupported, folderSupported,
          folderChoice, openFromFolderChoice, dismissFolderChoice,
          pickScfInRoot, phase,
          errorMessage } = useStore();
  return (
    <div className="start">
      <div className="start-card">
        <h1 className="start-mark">SCF</h1>
        <p className="start-sub">Story Context Framework — editor</p>
        {!fsAccessSupported && (
          <p className="start-warn">
            This browser has no File System Access API. Use a
            Chromium-based browser to open and save .scf files; the demo
            project still works here.
          </p>
        )}
        <div className="start-actions">
          {lastSession !== null && (
            <button className="primary" onClick={() => void resumeLast()}>
              Resume — {lastSession}
            </button>
          )}
          <button className={lastSession === null ? "primary" : ""}
                  onClick={() => void openProjectFolder()}
                  disabled={!folderSupported}>
            Open project folder…
          </button>
          <button className="ghost"
                  onClick={() => void openFromPicker()}
                  disabled={!fsAccessSupported}
                  title="Opens the .scf alone. Its assets cannot be
resolved, because the browser gives no route from a file to its folder.">
            Open a single .scf…
          </button>
          <button onClick={() => void newProject()}>New project</button>
          <button onClick={() => void openDemo()}>
            Open Hollow Creek demo
          </button>
        </div>
        {folderChoice !== null && (
          <div className="start-choice">
            {folderChoice.candidates.length > 0 &&
              folderChoice.findings.map((f, i) => (
                <p key={i} className="start-warn">{f.message}</p>
              ))}
            {folderChoice.candidates.length > 0 && (
              <>
                <p className="start-status">Which one is the project?</p>
                {folderChoice.candidates.map((name) => (
                  <button key={name}
                          onClick={() => void openFromFolderChoice(name)}>
                    {name}
                  </button>
                ))}
              </>
            )}
            {folderChoice.candidates.length === 0 && (
              <>
                <p className="start-status">
                  {folderChoice.seen.length === 0
                    ? "Folder connected. Which .scf is the project?"
                    : "No .scf found at the root — name it directly?"}
                </p>
                <button className="primary"
                        onClick={() => void pickScfInRoot()}>
                  Choose the .scf inside this folder…
                </button>
                <p className="start-foot">
                  The folder and its permission are already in hand. This
                  only asks which file; the project opens as a full
                  folder session either way, with its assets reachable.
                </p>
                {folderChoice.seen.length > 0 && (
                  <p className="start-foot">
                    Files seen at the root: {folderChoice.seen.join(", ")}
                  </p>
                )}
                <details className="start-report">
                  <summary>Why it could not find it itself</summary>
                  <p>
                    Directory listing is not available on every machine —
                    enterprise policy is the usual reason, and it is not
                    something this app can work around or detect in
                    advance.
                  </p>
                  <ul>
                    {folderChoice.report.map((line, i) => (
                      <li key={i} className="mono">{line}</li>
                    ))}
                  </ul>
                </details>
              </>
            )}
            <button className="ghost" onClick={dismissFolderChoice}>
              Pick another folder
            </button>
          </div>
        )}
        {phase === "loading" && <p className="start-status">Opening…</p>}
        {phase === "error" && (
          <>
            <p className="start-error">{errorMessage}</p>
            <button onClick={() => window.location.reload()}>
              Reload app
            </button>
          </>
        )}
        <p className="start-foot">
          Local-first. Your project stays on this machine — the file you
          open is copied into browser storage while you work, and written
          back when you save. A project is a folder holding one .scf and
          the assets it points at; opening the folder is what lets those
          assets resolve.
        </p>
      </div>
    </div>
  );
}

function MultiTabScreen(): JSX.Element {
  return (
    <div className="start">
      <div className="start-card">
        <h1 className="start-mark">SCF</h1>
        <p className="start-sub">Story Context Framework — editor</p>
        <p className="start-warn">
          SCF is already open in another tab. The working database uses
          exclusive browser storage handles, so only one tab can hold it
          at a time. Close the other tab, then
        </p>
        <button className="primary"
                onClick={() => window.location.reload()}>
          Try again here
        </button>
      </div>
    </div>
  );
}

export function App(): JSX.Element {
  const phase = useStore((s) => s.phase);
  const resumeLast = useStore((s) => s.resumeLast);
  const lastSession = useStore((s) => s.lastSession);
  const tried = useRef(false);

  // A refresh is not a close. The working database is still in browser
  // storage and the file handle is still in IndexedDB, so walk straight
  // back in — unless the last thing the user did was close the project,
  // in which case the start screen is what they asked for.
  useEffect(() => {
    if (tried.current || phase !== "start" || lastSession === null) return;
    tried.current = true;
    if (localStorage.getItem("scf:auto-resume") === "0") return;
    void resumeLast();
  }, [phase, lastSession, resumeLast]);

  if (phase === "multitab") return <MultiTabScreen />;
  return phase === "open" ? <Workbench /> : <StartScreen />;
}
