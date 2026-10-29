// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { AuditEvent, AuditStore } from "@scf-host/auditStore.ts";
import { windowAuditStore } from "../../host/windowAuditStore.ts";
import {
  actionLabel, actorLabel, baseName, buildFilter, DEFAULT_CONTROLS, formatTime,
  itemLabel, parseSummary, sortEvents, splitHeadline,
  type EventLogControls, type EventSortKey, type EventSummary,
} from "../../state/eventLogFormat.ts";

const PAGE = 200;
/** How often the open viewer looks for events written since. */
const POLL_MS = 2000;

const describe = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

const SORT_COLUMNS: { key: EventSortKey; label: string }[] = [
  { key: "time", label: "Time" }, { key: "who", label: "Who" },
  { key: "what", label: "What" }, { key: "project", label: "Project" },
];

/**
 * The event log: what happened to the user's projects and to the app,
 * and who did it. Reads the same `audit.db` the host writes; another
 * process (the assistant's) can be appending to it as this is open.
 */
export function EventLogView(): JSX.Element {
  const [store, setStore] = useState<AuditStore | null>(null);
  const [controls, setControls] = useState<EventLogControls>(DEFAULT_CONTROLS);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const head = useRef<number>(0);

  useEffect(() => {
    let live = true;
    windowAuditStore().then((s) => { if (live) setStore(s); })
      .catch((e: unknown) => {
        if (live) setError(`The event log is unavailable: ${describe(e)}`);
      });
    return () => { live = false; };
  }, []);

  /** The first page of what the controls ask for. */
  const load = useCallback(async (): Promise<void> => {
    if (store === null) return;
    try {
      const filter = buildFilter(controls, new Date());
      const [page, count, newest] = await Promise.all([
        store.query({ ...filter, limit: PAGE }), store.count(filter),
        store.query({ limit: 1 }),
      ]);
      head.current = newest[0]?.id ?? 0;
      setEvents(page);
      setTotal(count);
      setStale(false);
      setError(null);
    } catch (e) {
      setError(`Could not read the event log: ${describe(e)}`);
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
      setError(`Could not read the event log: ${describe(e)}`);
    }
  };

  const exportLog = async (): Promise<void> => {
    if (store === null) return;
    try {
      const path = await save({
        defaultPath: "scf-events.jsonl",
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

  const set = (patch: Partial<EventLogControls>): void => {
    setControls((c) => ({ ...c, ...patch }));
    setOpenId(null);
  };
  const sortToggle = (key: EventSortKey): void => {
    setControls((c) => ({
      ...c, sortKey: key,
      sortDir: c.sortKey === key && c.sortDir === "asc" ? "desc" : "asc",
    }));
  };
  const now = new Date();
  const sorted = useMemo(
    () => sortEvents(events, controls.sortKey, controls.sortDir),
    [events, controls.sortKey, controls.sortDir]);

  /** The headline with its trailing name broken out as its own
   *  clickable button — the Details cell and the expanded view both
   *  read this way, so clicking the name filters to just this item
   *  from either place. */
  const headlineNode = (e: AuditEvent, parsed: EventSummary): JSX.Element => {
    const targetUuid = e.targetUuid;
    const { prefix, name } = splitHeadline(parsed.headline);
    if (targetUuid === null || name === null) return <>{parsed.headline}</>;
    return (
      <>
        {prefix}
        <button className="ghost tiny elog-project"
                title="Only events on this item"
                onClick={(ev) => {
                  ev.stopPropagation();
                  set({ targetUuid, showLifecycle: true,
                        targetLabel: itemLabel(e.targetEntity, parsed.headline) });
                }}
                onKeyDown={(ev) => ev.stopPropagation()}>
          {name}
        </button>
      </>
    );
  };

  const sortHead = (key: EventSortKey, label: string): JSX.Element => {
    const active = controls.sortKey === key;
    return (
      <button type="button" className={"elog-sort" + (active ? " active" : "")}
              onClick={() => sortToggle(key)}>
        {label}{active && (controls.sortDir === "asc" ? " ▲" : " ▼")}
      </button>
    );
  };

  return (
    <div className="elog">
      <div className="elog-controls">
        <select aria-label="When" value={controls.range}
                onChange={(e) => set({
                  range: e.target.value as EventLogControls["range"] })}>
          <option value="hour">Last hour</option>
          <option value="today">Today</option>
          <option value="week">Last 7 days</option>
          <option value="all">All time</option>
        </select>
        <input type="search" placeholder="Search actions and details"
               aria-label="Search" value={controls.search}
               onChange={(e) => set({ search: e.target.value })} />
        <label className="elog-check"
               title="Opening, closing and reloading a project. An assistant does this around every tool call.">
          <input type="checkbox" checked={controls.showLifecycle}
                 onChange={(e) => set({ showLifecycle: e.target.checked })} />
          Show open/close
        </label>
      </div>

      {(controls.actor !== "" || controls.project !== "" ||
        controls.targetUuid !== null) && (
        <div className="elog-chips">
          {controls.actor !== "" && (
            <span className="elog-chip">
              Who: {actorLabel(controls.actor)}
              <button className="ghost tiny" aria-label="Clear who filter"
                      onClick={() => set({ actor: "" })}>×</button>
            </span>
          )}
          {controls.project !== "" && (
            <span className="elog-chip">
              Project: {baseName(controls.project)}
              <button className="ghost tiny" aria-label="Clear project filter"
                      onClick={() => set({ project: "" })}>×</button>
            </span>
          )}
          {controls.targetUuid !== null && (
            <span className="elog-chip">
              {controls.targetLabel ?? "Only this item"}
              <button className="ghost tiny" aria-label="Show all events"
                      onClick={() => set({ targetUuid: null, targetLabel: null })}>
                ×
              </button>
            </span>
          )}
        </div>
      )}
      {error !== null && <div className="elog-error" role="alert">{error}</div>}
      {stale && (
        <button className="elog-stale" onClick={() => void load()}>
          Newer events are available — refresh
        </button>
      )}

      <div className="elog-table" role="table" aria-label="Event log">
        <div className="elog-row elog-head" role="row">
          {SORT_COLUMNS.map(({ key, label }) => (
            <span key={key} role="columnheader">{sortHead(key, label)}</span>
          ))}
          <span role="columnheader">On</span>
          <span role="columnheader">Details</span>
        </div>
        {sorted.map((e) => {
          const open = openId === e.id;
          const parsed = parseSummary(e.action, e.summary, e.targetEntity);
          return (
            <div key={e.id} className={"elog-item" + (open ? " open" : "")}>
              <div className="elog-row" role="row" tabIndex={0}
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
                  <button className={`elog-actor elog-actor-${e.actorKind}`}
                          title={`Only events by ${actorLabel(e.actorKind)}`}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            set({ actor: e.actorKind });
                          }}
                          onKeyDown={(ev) => ev.stopPropagation()}>
                    {actorLabel(e.actorKind)}
                  </button>
                  {e.actorName !== null && e.actorName !== e.actorKind && (
                    <span className="muted elog-actor-name"> {e.actorName}</span>
                  )}
                </span>
                <span role="cell">{actionLabel(e.action)}</span>
                <span role="cell">
                  {(() => {
                    const projectPath = e.projectPath;
                    return projectPath === null
                      ? <span className="muted">—</span>
                      : (
                        <button className="ghost tiny elog-project"
                                title={projectPath}
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  set({ project: projectPath });
                                }}
                                onKeyDown={(ev) => ev.stopPropagation()}>
                          {baseName(projectPath)}
                        </button>
                      );
                  })()}
                </span>
                <span role="cell" className="muted">{e.targetEntity ?? ""}</span>
                <span role="cell" className="elog-summary">
                  {headlineNode(e, parsed)}
                </span>
              </div>
              {open && (
                <div className="elog-detail">
                  <p>{headlineNode(e, parsed)}</p>
                  {parsed.diff.length > 0 && (
                    <table className="elog-diff">
                      <thead>
                        <tr><th>Field</th><th>Before</th><th>After</th></tr>
                      </thead>
                      <tbody>
                        {parsed.diff.map((d) => (
                          <tr key={d.field}>
                            <td>{d.field}</td>
                            <td className="elog-diff-before">{d.before}</td>
                            <td className="elog-diff-after">{d.after}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {parsed.fields.length > 0 && (
                    <table className="elog-fields">
                      <thead>
                        <tr><th>Field</th><th>Value</th></tr>
                      </thead>
                      <tbody>
                        {parsed.fields.map((f) => (
                          <tr key={f.field}>
                            <td>{f.field}</td>
                            <td>{f.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {events.length === 0 && error === null && (
          <p className="muted elog-empty">
            {store === null ? "Opening the event log…"
              : total === 0 ? "No events match." : ""}
          </p>
        )}
      </div>

      <div className="elog-foot">
        <span className="muted">
          {events.length < total
            ? `${String(events.length)} of ${String(total)} events`
            : `${String(total)} event${total === 1 ? "" : "s"}`}
        </span>
        {events.length < total && (
          <button className="ghost" onClick={() => void more()}>Load more</button>
        )}
        <span className="elog-spacer" />
        {notice !== null && <span className="muted">{notice}</span>}
        <button onClick={() => void exportLog()} disabled={store === null}
                title="Save the events shown (all pages) as a JSON-lines file">
          Export…
        </button>
      </div>
    </div>
  );
}
