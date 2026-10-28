// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type {
  AuditEvent, AuditProject, AuditStore, AuditVerification,
} from "@scf-host/auditStore.ts";
import { windowAuditStore } from "../../host/windowAuditStore.ts";
import {
  actionLabel, baseName, buildFilter, formatTime, NO_CONTROLS, shortUuid,
  type AuditControls, type AuditRange,
} from "../../state/auditFormat.ts";

const PAGE = 200;
/** How often the open viewer looks for events written since. */
const POLL_MS = 2000;

const describe = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/**
 * The audit log: what happened to the user's projects and to the app,
 * and who did it. Reads the same `audit.db` the host writes; another
 * process (the assistant's) can be appending to it as this is open.
 */
export function AuditView(): JSX.Element {
  const [store, setStore] = useState<AuditStore | null>(null);
  const [controls, setControls] = useState<AuditControls>(NO_CONTROLS);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [projects, setProjects] = useState<AuditProject[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [verified, setVerified] = useState<AuditVerification | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const head = useRef<number>(0);

  useEffect(() => {
    let live = true;
    windowAuditStore().then((s) => { if (live) setStore(s); })
      .catch((e: unknown) => {
        if (live) setError(`The audit trail is unavailable: ${describe(e)}`);
      });
    return () => { live = false; };
  }, []);

  /** The first page of what the controls ask for. */
  const load = useCallback(async (): Promise<void> => {
    if (store === null) return;
    try {
      const filter = buildFilter(controls, new Date());
      const [page, count, known, newest] = await Promise.all([
        store.query({ ...filter, limit: PAGE }), store.count(filter),
        store.projects(), store.query({ limit: 1 }),
      ]);
      head.current = newest[0]?.id ?? 0;
      setEvents(page);
      setTotal(count);
      setProjects(known);
      setStale(false);
      setError(null);
    } catch (e) {
      setError(`Could not read the audit trail: ${describe(e)}`);
    }
  }, [store, controls]);

  useEffect(() => { void load(); }, [load]);

  // New events: a short list refreshes itself; a long one the person has
  // paged down keeps its place and says there is more.
  useEffect(() => {
    if (store === null) return;
    const timer = window.setInterval(() => {
      void store.query({ limit: 1 }).then((newest) => {
        const id = newest[0]?.id ?? 0;
        if (id === head.current) return;
        if (events.length <= PAGE) void load(); else setStale(true);
      }).catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [store, events.length, load]);

  const more = async (): Promise<void> => {
    const last = events[events.length - 1];
    if (store === null || last === undefined) return;
    try {
      const next = await store.query({
        ...buildFilter(controls, new Date()), limit: PAGE,
        beforeId: last.id });
      setEvents((have) => [...have, ...next]);
    } catch (e) {
      setError(`Could not read the audit trail: ${describe(e)}`);
    }
  };

  const verify = async (): Promise<void> => {
    if (store === null) return;
    setVerified(null);
    try {
      setVerified(await store.verify());
    } catch (e) {
      setError(`Could not check the audit trail: ${describe(e)}`);
    }
  };

  const exportLog = async (): Promise<void> => {
    if (store === null) return;
    try {
      const path = await save({
        defaultPath: "scf-audit.jsonl",
        filters: [{ name: "JSON lines", extensions: ["jsonl"] }],
      });
      if (path === null) return;
      const text = await store.exportJsonl(buildFilter(controls, new Date()));
      await invoke("fs_write_text", { path, text });
      setNotice(`Exported ${String(total)} events to ${path}`);
    } catch (e) {
      setError(`Could not export: ${describe(e)}`);
    }
  };

  const set = (patch: Partial<AuditControls>): void => {
    setControls((c) => ({ ...c, ...patch }));
    setOpenId(null);
  };
  const now = new Date();

  return (
    <div className="audit">
      <div className="audit-controls">
        <select aria-label="Scope" value={controls.scope}
                onChange={(e) => set({
                  scope: e.target.value as AuditControls["scope"] })}>
          <option value="">Project and app</option>
          <option value="project">Projects only</option>
          <option value="app">App only</option>
        </select>
        <select aria-label="Project" value={controls.project}
                onChange={(e) => set({ project: e.target.value })}>
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.path} value={p.path} title={p.path}>
              {baseName(p.path)} ({p.events})
            </option>
          ))}
        </select>
        <select aria-label="Who" value={controls.actor}
                onChange={(e) => set({
                  actor: e.target.value as AuditControls["actor"] })}>
          <option value="">Anyone</option>
          <option value="user">You</option>
          <option value="agent">Assistants</option>
          <option value="external">Outside the editor</option>
          <option value="media">Media server</option>
        </select>
        <select aria-label="When" value={controls.range}
                onChange={(e) => set({ range: e.target.value as AuditRange })}>
          <option value="all">Any time</option>
          <option value="hour">Last hour</option>
          <option value="day">Last 24 hours</option>
          <option value="week">Last 7 days</option>
        </select>
        <input type="search" placeholder="Search actions and details"
               aria-label="Search" value={controls.search}
               onChange={(e) => set({ search: e.target.value })} />
        <label className="audit-check"
               title="Opening, closing and reloading a project. An assistant does this around every tool call.">
          <input type="checkbox" checked={controls.showLifecycle}
                 onChange={(e) => set({ showLifecycle: e.target.checked })} />
          Show open/close
        </label>
      </div>

      {controls.targetUuid !== null && (
        <div className="audit-chip">
          Only events on item <code>{shortUuid(controls.targetUuid)}</code>
          <button className="ghost tiny" aria-label="Show all events"
                  onClick={() => set({ targetUuid: null })}>×</button>
        </div>
      )}
      {error !== null && <div className="audit-error" role="alert">{error}</div>}
      {stale && (
        <button className="audit-stale" onClick={() => void load()}>
          Newer events are available — refresh
        </button>
      )}

      <div className="audit-table" role="table" aria-label="Audit events">
        <div className="audit-row audit-head" role="row">
          <span role="columnheader">Time</span>
          <span role="columnheader">Who</span>
          <span role="columnheader">What</span>
          <span role="columnheader">On</span>
          <span role="columnheader">Details</span>
        </div>
        {events.map((e) => {
          const open = openId === e.id;
          return (
            <div key={e.id} className={"audit-item" + (open ? " open" : "")}>
              <div className="audit-row" role="row" tabIndex={0}
                   aria-expanded={open}
                   onClick={() => setOpenId(open ? null : e.id)}
                   onKeyDown={(k) => {
                     if (k.key === "Enter" || k.key === " ") {
                       k.preventDefault();
                       setOpenId(open ? null : e.id);
                     }
                   }}>
                <span role="cell" title={e.at}>{formatTime(e.at, now)}</span>
                <span role="cell">
                  <span className={`audit-actor audit-actor-${e.actorKind}`}>
                    {e.actorKind}
                  </span>
                  {e.actorName !== null && e.actorName !== e.actorKind && (
                    <span className="muted audit-actor-name"> {e.actorName}</span>
                  )}
                </span>
                <span role="cell">{actionLabel(e.action)}</span>
                <span role="cell" className="muted">{e.targetEntity ?? ""}</span>
                <span role="cell" className="audit-summary">
                  {e.summary ?? ""}
                </span>
              </div>
              {open && (
                <div className="audit-detail">
                  {e.summary !== null && <p>{e.summary}</p>}
                  <dl>
                    <dt>Action</dt><dd><code>{e.action}</code></dd>
                    {e.projectPath !== null && (
                      <><dt>Project</dt><dd>{e.projectPath}</dd></>
                    )}
                    {e.targetUuid !== null && (
                      <><dt>Item</dt>
                        <dd><code>{e.targetUuid}</code>{" "}
                          <button className="ghost tiny"
                                  onClick={() => set({
                                    targetUuid: e.targetUuid,
                                    showLifecycle: true })}>
                            Only this item
                          </button>
                        </dd></>
                    )}
                    <dt>Event</dt>
                    <dd>#{e.id} <span className="muted">
                      · <code>{e.hash.slice(0, 12)}</code></span></dd>
                  </dl>
                </div>
              )}
            </div>
          );
        })}
        {events.length === 0 && error === null && (
          <p className="muted audit-empty">
            {store === null ? "Opening the audit trail…"
              : total === 0 ? "No events match." : ""}
          </p>
        )}
      </div>

      <div className="audit-foot">
        <span className="muted">
          {events.length < total
            ? `${String(events.length)} of ${String(total)} events`
            : `${String(total)} event${total === 1 ? "" : "s"}`}
        </span>
        {events.length < total && (
          <button className="ghost" onClick={() => void more()}>Load more</button>
        )}
        <span className="audit-spacer" />
        {verified !== null && (
          <span className={verified.ok ? "audit-ok" : "audit-bad"} role="status">
            {verified.ok
              ? `Chain intact — ${String(verified.count)} events`
              : `Chain broken${verified.brokenAt === null ? ""
                  : ` at event ${String(verified.brokenAt)}`}: ${
                  verified.reason}`}
          </span>
        )}
        {notice !== null && <span className="muted">{notice}</span>}
        <button onClick={() => void verify()} disabled={store === null}
                title="Check that no event has been changed or removed">
          Verify
        </button>
        <button onClick={() => void exportLog()} disabled={store === null}
                title="Save the events shown (all pages) as a JSON-lines file">
          Export…
        </button>
      </div>
    </div>
  );
}
