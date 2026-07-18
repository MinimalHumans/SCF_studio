import { useStore } from "../state/store.ts";
import { Workbench } from "./Workbench.tsx";

function StartScreen(): JSX.Element {
  const { openDemo, openFromPicker, newProject, fsAccessSupported,
          phase, errorMessage } = useStore();
  return (
    <div className="start">
      <div className="start-card">
        <h1 className="start-mark">SCF</h1>
        <p className="start-sub">Story Craft Format — editor</p>
        {!fsAccessSupported && (
          <p className="start-warn">
            This browser has no File System Access API. Use a
            Chromium-based browser to open and save .scf files; the demo
            project still works here.
          </p>
        )}
        <div className="start-actions">
          <button className="primary" onClick={() => void openFromPicker()}
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
          <p className="start-error">{errorMessage}</p>
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

export function App(): JSX.Element {
  const phase = useStore((s) => s.phase);
  return phase === "open" ? <Workbench /> : <StartScreen />;
}
