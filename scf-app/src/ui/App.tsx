// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef } from "react";
import { useStore } from "../state/store.ts";
import { Workbench } from "./Workbench.tsx";
import logoBigCloud from "../assets/logoBig_cloud.svg";
import logoMinimalHumans from "../assets/minimalHumans_logoShort.svg";

function StartScreen(): JSX.Element {
  const { openDemo, openFromPicker, newProject, hostStatus, hostError,
          connect, phase, errorMessage } = useStore();
  const ready = hostStatus === "ready";
  return (
    <div className="start">
      <div className="start-card">
        <h1 className="start-mark">
          <img src={logoBigCloud} alt="SCF" />
        </h1>
        <p className="start-sub">Story Context Framework — editor</p>
        {hostStatus === "connecting" && (
          <p className="start-status" role="status">
            {hostError ?? "Connecting to the SCF host…"}
          </p>
        )}
        {hostStatus === "unavailable" && (
          <>
            <p className="start-error">
              The SCF host is not reachable: {hostError}
            </p>
            <button onClick={() => void connect()}>Try again</button>
          </>
        )}
        <div className="start-actions">
          <button className="primary" disabled={!ready}
                  onClick={() => void newProject()}>
            New Project
          </button>
          <button disabled={!ready}
                  onClick={() => void openFromPicker()}
                  title="Opens the file. Its asset folder is attached
afterwards, from the topbar — the browser cannot find the folder from
the file, but it can confirm the one you name holds it.">
            Open an SCF File
          </button>
          <button disabled={!ready} onClick={() => void openDemo()}>
            Open Hollow Creek Demo
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
        {phase === "start" && errorMessage !== null && (
          <p className="start-error">{errorMessage}</p>
        )}
      </div>
      <a className="start-maker" href="https://www.minimalhumans.com"
         target="_blank" rel="noopener noreferrer">
        <img src={logoMinimalHumans} alt="Minimal Humans" />
      </a>
    </div>
  );
}

function MultiTabScreen(): JSX.Element {
  return (
    <div className="start">
      <div className="start-card">
        <h1 className="start-mark">
          <img src={logoBigCloud} alt="SCF" />
        </h1>
        <p className="start-sub">Story Context Framework — editor</p>
        <p className="start-warn">
          SCF is already open in another tab. Two windows editing one
          film would each save their own copy of the script over the
          other's, so only one tab is allowed at a time. Close the other
          tab, then
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
  const hostStatus = useStore((s) => s.hostStatus);
  const connect = useStore((s) => s.connect);
  const resumeLast = useStore((s) => s.resumeLast);
  const lastSession = useStore((s) => s.lastSession);
  const tried = useRef(false);
  const connecting = useRef(false);

  // The host starts with the dev server, possibly a moment after the
  // page: connect (retrying) as soon as the app is up.
  useEffect(() => {
    if (connecting.current) return;
    connecting.current = true;
    void connect();
  }, [connect]);

  // A refresh is not a close. The host still has the file and the path
  // is in browser storage, so walk straight back in — unless the last
  // thing the user did was close the project, in which case the start
  // screen is what they asked for.
  useEffect(() => {
    if (tried.current || phase !== "start" || lastSession === null) return;
    if (hostStatus !== "ready") return;
    tried.current = true;
    if (localStorage.getItem("scf:auto-resume") === "0") return;
    void resumeLast();
  }, [phase, hostStatus, lastSession, resumeLast]);

  return phase === "multitab" ? <MultiTabScreen />
    : phase === "open" ? <Workbench /> : <StartScreen />;
}
