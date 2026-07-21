import { useStore } from "../state/store.ts";
import { Workbench } from "./Workbench.tsx";

function StartScreen(): JSX.Element {
  const { openDemo, openFromPicker, newProject, resumeLast,
          lastSession, fsAccessSupported, phase,
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
                  onClick={() => void openFromPicker()}
                  disabled={!fsAccessSupported}>
            Open project…
          </button>
          <button onClick={() => void newProject()}>New project</button>
          <button onClick={() => void openDemo()}>
            Open Hollow Creek demo
          </button>
        </div>
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
          back when you save.
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
  if (phase === "multitab") return <MultiTabScreen />;
  return phase === "open" ? <Workbench /> : <StartScreen />;
}
