// SPDX-License-Identifier: Apache-2.0
/**
 * IdentityPanel — the uuid inspector.
 *
 * Row identity has been a framework column on all 99 entities since
 * schema 2.3, backfilled on open, and never once shown. That made it
 * unobservable rather than merely unverified: nothing in the app could
 * tell you whether a backfill reached every table, which row a uuid
 * belongs to, or whether a version chain still agreed with itself.
 *
 * Three questions, in the order they get asked:
 *
 *   Browse   — pick a table, read the uuids off it.
 *   Lookup   — paste a uuid, find the row, open it.
 *   This row — identity, lineage, external binding for what is open.
 *   Coverage — per-table uuid counts and the structural defects.
 *   Assets   — where every asset identifier resolves to (P3).
 *
 * All of the work happens in scf-core/identity.ts, which is where the
 * tests are. This file renders and navigates; it decides nothing, and
 * it repairs nothing (conventions §2 — SCF reports).
 */

import { Fragment, useEffect, useState } from "react";
import {
  auditIdentity, browseUuids, findByUuid, rowIdentity,
  type IdentityAudit, type RowIdentity, type UuidHit, type UuidRow,
} from "@scf-core/identity.ts";
import { exec, registry, useStore } from "../state/store.ts";
import type { ResolutionReport, ResolutionState }
  from "@scf-core/assets.ts";

function Finding({ detail }: { detail: string }): JSX.Element {
  return <li className="identity-finding">{detail}</li>;
}

function CopyUuid({ uuid }: { uuid: string | null }): JSX.Element {
  const [copied, setCopied] = useState(false);
  if (uuid === null) {
    return <span className="identity-finding">no uuid</span>;
  }
  return (
    <button className="ghost tiny mono identity-uuid"
            title="Copy uuid"
            onClick={() => {
              void navigator.clipboard.writeText(uuid);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }}>
      {copied ? "copied" : `${uuid.slice(0, 8)}…`}
    </button>
  );
}

/**
 * The lookup box below is only usable by someone who already has a
 * uuid, and nothing in the app ever printed one. This is where you get
 * the first one.
 */
function Browse(): JSX.Element {
  const { openEntityRow } = useStore();
  const [table, setTable] = useState("character");
  const [page, setPage] = useState<{ rows: UuidRow[]; total: number }>(
    { rows: [], total: 0 });
  const [offset, setOffset] = useState(0);
  const PAGE = 25;

  useEffect(() => {
    void (async () => {
      setPage(await browseUuids(exec, registry, table, PAGE, offset));
    })();
  }, [table, offset]);

  return (
    <section>
      <h4>Browse identities</h4>
      <select value={table}
              onChange={(e) => { setTable(e.target.value); setOffset(0); }}>
        {registry.order.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      {page.total === 0
        ? <p className="muted">No rows in this table.</p>
        : (
          <>
            <ul className="integrity-list">
              {page.rows.map((r) => (
                <li key={r.id}>
                  <span className="identity-table mono">#{r.id}</span>
                  <span className="identity-name">
                    {r.label ?? <em className="muted">unnamed</em>}
                  </span>
                  <CopyUuid uuid={r.uuid} />
                  <button className="ghost tiny"
                          onClick={() => { void openEntityRow(table, r.id); }}>
                    Open
                  </button>
                </li>
              ))}
            </ul>
            <div className="identity-paging">
              <button className="ghost tiny" disabled={offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                ←
              </button>
              <span className="muted">
                {offset + 1}–{Math.min(offset + PAGE, page.total)} of{" "}
                {page.total}
              </span>
              <button className="ghost tiny"
                      disabled={offset + PAGE >= page.total}
                      onClick={() => setOffset(offset + PAGE)}>
                →
              </button>
            </div>
          </>
        )}
    </section>
  );
}

function Lookup(): JSX.Element {
  const { openEntityRow } = useStore();
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<UuidHit[] | null>(null);
  const [busy, setBusy] = useState(false);

  const run = (): void => {
    void (async () => {
      setBusy(true);
      setHits(await findByUuid(exec, registry, term));
      setBusy(false);
    })();
  };

  return (
    <section>
      <h4>Find a uuid</h4>
      <div className="identity-lookup">
        <input
          className="mono"
          value={term}
          placeholder="paste a uuid"
          spellCheck={false}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") run(); }}
        />
        <button className="tiny" onClick={run}
                disabled={term.trim() === ""}>Find</button>
      </div>

      {busy && <p className="muted">Searching…</p>}

      {!busy && hits !== null && hits.length === 0 && (
        <p className="muted">
          No row in this file carries that uuid. A uuid is minted per
          file, so one from another .scf will not be found here.
        </p>
      )}

      {!busy && hits !== null && hits.length > 1 && (
        <p className="identity-finding">
          {hits.length} rows share this uuid. The unique index should
          make that impossible — this file has a real defect.
        </p>
      )}

      {!busy && hits !== null && hits.length > 0 && (
        <ul className="integrity-list">
          {hits.map((h) => (
            <li key={`${h.table}:${h.id}`}>
              <span className="identity-table mono">{h.table}</span>
              <span>{h.label ?? <em className="muted">unnamed</em>}</span>
              <button className="ghost tiny"
                      onClick={() => { void openEntityRow(h.table, h.id); }}>
                Open
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ThisRow(): JSX.Element | null {
  const { openRow, openEntityRow } = useStore();
  const [ident, setIdent] = useState<RowIdentity | null>(null);

  useEffect(() => {
    if (openRow === null || openRow.id === null) {
      setIdent(null);
      return;
    }
    void (async () => {
      setIdent(await rowIdentity(exec, registry, openRow.entity, openRow.id!));
    })();
  }, [openRow?.entity, openRow?.id]);

  if (openRow === null || openRow.id === null) {
    return (
      <section>
        <h4>This row</h4>
        <p className="muted">
          Open any row to see its identity, version chain and external
          binding.
        </p>
      </section>
    );
  }

  if (ident === null) return <section><h4>This row</h4></section>;

  return (
    <section>
      <h4>{ident.entityLabel} #{ident.id}</h4>

      <dl className="identity-facts">
        <dt>uuid</dt>
        <dd className="mono identity-uuid-full">
          {ident.uuid ?? <em className="muted">none</em>}
          {ident.uuid !== null && (
            <button className="ghost tiny"
                    onClick={() => {
                      void navigator.clipboard.writeText(ident.uuid as string);
                    }}>copy</button>
          )}
        </dd>
        {ident.lifecycleStatus !== null && (
          <>
            <dt>lifecycle</dt>
            <dd>{ident.lifecycleStatus}</dd>
          </>
        )}
        {ident.externalId !== null && (
          <>
            <dt>external</dt>
            <dd className="mono">
              {ident.externalIdNamespace ?? "?"}:{ident.externalId}
            </dd>
          </>
        )}
      </dl>

      {ident.naturalKey !== null && (
        <>
          <h4>Natural key</h4>
          <p className="muted">
            What identifies this link across files, where a uuid cannot
            (conventions §5).
          </p>
          <dl className="identity-facts">
            {ident.naturalKey.map((p) => (
              <Fragment key={p.field}>
                <dt className="mono">{p.field}</dt>
                <dd className="mono">
                  {p.value === null ? "—" : String(p.value)}
                </dd>
              </Fragment>
            ))}
          </dl>
        </>
      )}

      {ident.versionable && (
        <>
          <h4>Version chain</h4>
          {ident.chain.length <= 1 ? (
            <p className="muted">Single version — no parent, no successor.</p>
          ) : (
            <ol className="identity-chain">
              {ident.chain.map((link) => (
                <li key={link.id} className={link.self ? "self" : ""}>
                  <span className="mono">#{link.id}</span>
                  <span>{link.versionLabel ?? "unlabelled"}</span>
                  {link.lifecycleStatus !== null &&
                    link.lifecycleStatus !== "active" && (
                    <span className="rail-orphan">{link.lifecycleStatus}</span>
                  )}
                  {!link.self && (
                    <button className="ghost tiny"
                            onClick={() => {
                              void openEntityRow(ident.table, link.id);
                            }}>
                      Open
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      {ident.findings.length > 0 && (
        <ul className="integrity-list">
          {ident.findings.map((f, i) => (
            <Finding key={i} detail={f.detail} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Coverage({ audit }: { audit: IdentityAudit }): JSX.Element {
  const [showAll, setShowAll] = useState(false);
  const populated = audit.tables.filter((t) => t.present && t.rows > 0);
  const shown = showAll ? audit.tables.filter((t) => t.present) : populated;

  return (
    <section>
      <h4>Coverage</h4>
      <p className="muted">
        {audit.totals.withUuid} of {audit.totals.rows} rows carry a uuid,
        across {populated.length} populated{" "}
        {populated.length === 1 ? "table" : "tables"}. Schema{" "}
        {audit.schemaVersion}.
      </p>

      {audit.clean && (
        <p className="muted">Every row in this file has unique, well-formed
          identity.</p>
      )}

      {audit.findings.length > 0 && (
        <ul className="integrity-list">
          {audit.findings.map((f, i) => (
            <Finding key={i} detail={f.detail} />
          ))}
        </ul>
      )}

      <table className="identity-table-list">
        <thead>
          <tr><th>table</th><th>rows</th><th>uuid</th></tr>
        </thead>
        <tbody>
          {shown.map((t) => (
            <tr key={t.table}
                className={t.missingUuid > 0 || t.malformed > 0 ||
                           t.duplicated > 0 ? "flagged" : ""}>
              <td className="mono">{t.table}</td>
              <td>{t.rows}</td>
              <td>
                {t.rows === 0 ? "—"
                  : t.missingUuid === 0 && t.malformed === 0 ? "✓"
                  : `${t.withUuid - t.malformed}/${t.rows}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button className="ghost tiny"
              onClick={() => setShowAll((v) => !v)}>
        {showAll ? "Only populated tables" : `All ${
          audit.tables.filter((t) => t.present).length} tables`}
      </button>
    </section>
  );
}

const STATE_LABEL: Record<ResolutionState, string> = {
  resolved: "resolved",
  missing: "missing",
  unmaterialised: "not downloaded",
  "out-of-root": "outside the project",
  unaddressed: "no identifier",
};

/**
 * Where the assets point, and whether anything is there.
 *
 * `missing` and `not downloaded` are deliberately separate rows: a
 * synced project full of placeholders is healthy, and collapsing the
 * two would report it as broken (conventions §9).
 */
function Assets(): JSX.Element {
  const { resolveAssets, projectRoot, rootTraversalError,
          openEntityRow } = useStore();
  const [report, setReport] = useState<ResolutionReport | null>(null);
  const [busy, setBusy] = useState(false);

  const run = (): void => {
    void (async () => {
      setBusy(true);
      setReport(await resolveAssets());
      setBusy(false);
    })();
  };

  useEffect(run, []);

  const problems = (report?.assets ?? []).filter(
    (a) => a.state !== "resolved");

  return (
    <section>
      <h4>Assets</h4>
      {projectRoot === null && (
        <p className="muted">
          This session has no project folder, so nothing can resolve.
          Everything below is listed, not broken.
        </p>
      )}
      {rootTraversalError !== null && (
        <p className="identity-finding">{rootTraversalError}</p>
      )}
      {busy && <p className="muted">Resolving…</p>}

      {report !== null && report.total === 0 && (
        <p className="muted">No assets in this file.</p>
      )}

      {report !== null && report.total > 0 && (
        <>
          <table className="identity-table-list">
            <tbody>
              {(Object.keys(STATE_LABEL) as ResolutionState[])
                .filter((k) => report.counts[k] > 0)
                .map((k) => (
                  <tr key={k} className={k === "resolved" ? "" : "flagged"}>
                    <td>{STATE_LABEL[k]}</td>
                    <td>{report.counts[k]}</td>
                  </tr>
                ))}
            </tbody>
          </table>

          {problems.length > 0 && (
            <ul className="integrity-list">
              {problems.slice(0, 40).map((a) => (
                <li key={a.id}>
                  <span className="identity-name">
                    {a.name ?? <em className="muted">unnamed</em>}
                  </span>
                  <span className="identity-table mono">
                    {STATE_LABEL[a.state]}
                  </span>
                  <button className="ghost tiny"
                          onClick={() => { void openEntityRow("asset", a.id); }}>
                    Open
                  </button>
                  {a.detail !== null && (
                    <span className="identity-finding">{a.detail}</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <button className="ghost tiny" onClick={run}>Re-resolve</button>
        </>
      )}
    </section>
  );
}

export function IdentityPanel({ onClose }: {
  onClose: () => void;
}): JSX.Element {
  const [audit, setAudit] = useState<IdentityAudit | null>(null);

  useEffect(() => {
    void (async () => {
      setAudit(await auditIdentity(exec, registry));
    })();
  }, []);

  return (
    <aside className="integrity-panel identity-panel">
      <div className="integrity-head">
        <h3>Identity</h3>
        <button className="ghost tiny" onClick={onClose}
                aria-label="close">×</button>
      </div>

      <ThisRow />
      <Assets />
      <Browse />
      <Lookup />
      {audit === null
        ? <section><p className="muted">Auditing…</p></section>
        : <Coverage audit={audit} />}
    </aside>
  );
}
