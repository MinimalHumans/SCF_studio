// SPDX-License-Identifier: Apache-2.0
/**
 * ImportFlow — the staging screen between parsing and rows.
 *
 * The Part 2 contract made visible: repairs are listed (before → after),
 * scene/location proposals summarize (near-deterministic, accepted as a
 * unit), characters arrive as a review table — confidence, occurrences,
 * suspicions, normalization steps, rename-in-place — with best-guess
 * defaults prechecked; props are always unchecked. Nothing touches the
 * database until [Import], and everything created is marked
 * machine-created.
 */

import { useMemo, useState } from "react";
import { exec } from "../state/store.ts";
import {
  applyImport, defaultAcceptance, prepareImport, titleCase,
  type ImportResult, type PreparedImport,
} from "../editor/importPipeline.ts";
import type { CharacterProposal } from "@scf-core/proposals/propose.ts";

interface CharRow {
  key: string;
  proposal: CharacterProposal;
  accepted: boolean;
  name: string;
  showWork: boolean;
}

export function ImportFlow({ onClose, onDone }: {
  onClose: () => void;
  onDone: () => void | Promise<void>;
}): JSX.Element {
  const [prepared, setPrepared] = useState<PreparedImport | null>(null);
  const [fileName, setFileName] = useState("");
  const [chars, setChars] = useState<CharRow[]>([]);
  const [props, setProps] = useState<Array<{
    key: string; accepted: boolean; name: string; occurrences: number;
    confidence: string; score: number; scenes: number; signals: string[];
  }>>([]);
  const [busy, setBusy] = useState(false);
  const [busyStep, setBusyStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [showRepairs, setShowRepairs] = useState(false);

  const pick = async (file: File): Promise<void> => {
    setError(null);
    // Strict UTF-8 first; on invalid bytes fall back to Windows-1252
    // (the classic curly-apostrophe-becomes-\uFFFD export encoding).
    const buffer = await file.arrayBuffer();
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      text = new TextDecoder("windows-1252").decode(buffer);
    }
    const kind = file.name.toLowerCase().endsWith(".fdx")
      ? "fdx" as const : "fountain" as const;
    let p: PreparedImport;
    try {
      p = prepareImport(text, kind);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setFileName(file.name);
    setPrepared(p);
    const defaults = defaultAcceptance(p.proposals);
    setChars(p.proposals.characters
      .slice()
      .sort((a, b) => b.occurrences - a.occurrences)
      .map((proposal) => ({
        key: proposal.name.toUpperCase(),
        proposal,
        accepted: defaults.characterNames.has(proposal.name.toUpperCase()),
        name: titleCase(proposal.name),
        showWork: false,
      })));
    setProps(p.proposals.props
      .slice()
      .sort((a, b) => b.score - a.score || b.occurrences - a.occurrences)
      .map((x) => ({
        key: x.name.toUpperCase(), accepted: false,
        name: x.name, occurrences: x.occurrences,
        confidence: x.confidence, score: x.score, scenes: x.scenes,
        signals: x.signals,
      })));
  };

  const doImport = async (): Promise<void> => {
    if (prepared === null) return;
    setBusy(true);
    setError(null);
    const characterNames = new Map<string, string>();
    for (const c of chars) {
      if (c.accepted && c.name.trim() !== "") {
        characterNames.set(c.key, c.name.trim());
      }
    }
    const propNames = new Map<string, string>();
    for (const x of props) {
      if (x.accepted && x.name.trim() !== "") {
        propNames.set(x.key, x.name.trim());
      }
    }
    try {
      const r = await applyImport(exec, prepared, {
        scenes: true, characterNames, props: propNames,
      }, setBusyStep);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const suspectCount = useMemo(() =>
    prepared?.proposals.characters
      .filter((c) => c.suspicions.length > 0).length ?? 0,
    [prepared]);

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true">
      <div className="modal import-flow">
        <div className="modal-head">
          <h2>Import screenplay</h2>
          <button onClick={onClose} aria-label="close">×</button>
        </div>

        {prepared === null && (
          <div className="import-pick">
            {error !== null && (
              <p className="import-error">Could not parse: {error}</p>
            )}
            <p>Fountain (.fountain, .txt) or Final Draft (.fdx).
               Conversion damage gets a bounded repair pass — every
               repair is shown. Nothing is written until you accept.</p>
            <p className="muted import-readonly">
               Your file is read once and never written to. Everything
               you do afterwards is saved in the .scf; exporting produces
               a new .fountain, it does not update this one.</p>
            <input type="file" accept=".fountain,.txt,.fdx"
                   onChange={(e) => {
                     const f = e.target.files?.[0];
                     if (f !== undefined) void pick(f);
                   }} />
          </div>
        )}

        {prepared !== null && result === null && (
          <div className="import-stage">
            <p className="import-summary">
              <b>{fileName}</b> — {prepared.doc.lines.length} lines.{" "}
              {prepared.repairs.length > 0 ? (
                <button className="linkish"
                        onClick={() => setShowRepairs(!showRepairs)}>
                  {prepared.repairs.length} conversion repairs
                  {showRepairs ? " ▾" : " ▸"}
                </button>
              ) : "No repairs needed."}
            </p>
            {showRepairs && (
              <ul className="repair-list">
                {prepared.repairs.slice(0, 50).map((r) => (
                  <li key={r.line}>
                    <code>{r.before}</code> → <code>{r.after}</code>
                  </li>
                ))}
                {prepared.repairs.length > 50 && (
                  <li className="muted">
                    …and {prepared.repairs.length - 50} more
                  </li>
                )}
              </ul>
            )}

            <h3>
              Scenes & locations
              <span className="muted"> — near-deterministic, accepted
                together</span>
            </h3>
            <p>
              {prepared.proposals.scenes.length} scenes,{" "}
              {prepared.proposals.locations.length} locations
              {prepared.proposals.locations.some(
                (l) => l.mergeCandidates.length > 0) && (
                <span className="muted">
                  {" "}(some names look mergeable — review after import)
                </span>
              )}
            </p>

            <h3>
              Characters
              <span className="muted"> — {chars.length} proposed,{" "}
                {suspectCount} flagged suspect, best guess prechecked
              </span>
            </h3>
            <table className="qtable import-chars">
              <thead>
                <tr>
                  <th></th><th>name</th><th>cues</th><th>confidence</th>
                  <th>notes</th>
                </tr>
              </thead>
              <tbody>
                {chars.map((c, i) => (
                  <tr key={c.key}
                      className={c.accepted ? "" : "unaccepted"}>
                    <td>
                      <input type="checkbox" checked={c.accepted}
                             onChange={(e) => {
                               const next = [...chars];
                               next[i] = { ...c,
                                 accepted: e.target.checked };
                               setChars(next);
                             }} />
                    </td>
                    <td>
                      <input className="char-name" value={c.name}
                             onChange={(e) => {
                               const next = [...chars];
                               next[i] = { ...c, name: e.target.value };
                               setChars(next);
                             }} />
                    </td>
                    <td>{c.proposal.occurrences}</td>
                    <td>
                      <span className={`conf conf-${c.proposal.confidence}`}>
                        {c.proposal.confidence}
                      </span>
                    </td>
                    <td className="char-notes">
                      {c.proposal.splitOf !== undefined && (
                        <span>split of “{c.proposal.splitOf}” · </span>
                      )}
                      {c.proposal.suspicions.map((s) => (
                        <span key={s} className="suspicion">
                          {s.replace(/^!/, "")}
                        </span>
                      ))}
                      {c.proposal.normalizations.length > 0 && (
                        <button className="linkish" onClick={() => {
                          const next = [...chars];
                          next[i] = { ...c, showWork: !c.showWork };
                          setChars(next);
                        }}>
                          {c.showWork ? "hide work" : "show work"}
                        </button>
                      )}
                      {c.showWork && (
                        <ul className="norm-steps">
                          {c.proposal.normalizations.map((n, k) => (
                            <li key={k}>
                              {n.step}: <code>{n.before}</code> →{" "}
                              <code>{n.after}</code>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3>
              Props
              <span className="muted"> — a head start, not a census</span>
            </h3>
            <p className="muted prop-note">
              Two signals: an object introduced in caps where a noun
              belongs, and anything a character picks up, draws, or
              opens. Strongest candidates first — the tail is thin
              evidence, and plenty of real props will be missing
              entirely. Nothing here is created unless you tick it;
              selecting text in the script and making a prop from it
              stays the accurate path.
              {props.length > 0 && (
                <> {props.length} candidate
                  {props.length === 1 ? "" : "s"},{" "}
                  {props.filter((x) => x.confidence === "medium").length}
                  {" "}with more than one signal.</>
              )}
            </p>
            {props.length === 0
              ? <p className="muted">No candidates found.</p>
              : (
              <table className="qtable">
                <tbody>
                  {props.map((x, i) => (
                    <tr key={x.key}
                        className={x.confidence === "medium"
                          ? "" : "prop-weak"}>
                      <td>
                        <input type="checkbox" checked={x.accepted}
                               onChange={(e) => {
                                 const next = [...props];
                                 next[i] = { ...x,
                                   accepted: e.target.checked };
                                 setProps(next);
                               }} />
                      </td>
                      <td>{x.name}</td>
                      <td>{x.occurrences}× in {x.scenes} scene
                        {x.scenes === 1 ? "" : "s"}</td>
                      <td>
                        {x.signals.map((sig) => (
                          <span key={sig} className="scope-tag">{sig}</span>
                        ))}
                      </td>
                      <td>
                        <span className={`conf conf-${x.confidence}`}>
                          {x.confidence}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {error !== null && (
              <p className="import-error">Import failed: {error}</p>
            )}
            <div className="modal-actions">
              <span className="muted">
                Everything created is marked machine-created.
              </span>
              <span className="flex-spacer" />
              <button onClick={onClose}>Cancel</button>
              <button className="primary" disabled={busy}
                      onClick={() => void doImport()}>
                {busy ? `Importing… ${busyStep}` : "Import"}
              </button>
            </div>
          </div>
        )}

        {result !== null && (
          <div className="import-done">
            <p>
              Imported <b>{result.lines}</b> lines — {result.scenes}{" "}
              scenes, {result.locations} locations, {result.characters}{" "}
              characters, {result.links} scene links
              {result.props > 0
                ? `, ${result.props} props placed in ` +
                  `${result.propLinks} scene` +
                  `${result.propLinks === 1 ? "" : "s"}`
                : ""}.
            </p>
            <div className="modal-actions">
              <span className="flex-spacer" />
              <button className="primary" onClick={() => void onDone()}>
                Open in editor
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
