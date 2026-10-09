// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import { newUuid, q, type Row, type SqlValue } from "@scf-core/db.ts";
import {
  DEFAULT_NUMBERING_POLICY, type NumberingPolicy,
} from "@scf-core/numbering.ts";
import { exec, registry, useStore } from "../../state/store.ts";
import { setField } from "../../editor/elementOps.ts";
import { useQuery } from "../useQuery.ts";
import { Field } from "../fields/Field.tsx";
import { asPolicy, NumberingPolicyConfirm } from "../NumberingPolicyConfirm.tsx";
import { AutoField } from "./AutoField.tsx";
import { fail, FileIntake, type Incoming } from "./BoardParts.tsx";
import { AssetPreview } from "../AssetPreview.tsx";
import {
  detachMedia, loadPosters, setPoster, type MediaTile,
} from "../../editor/relatedMediaOps.ts";
import { registerFiles, withCreatedAssets } from "../../editor/mediaOps.ts";

/**
 * ProjectWorkspace — the baseline of the film, in one place.
 *
 * Everything here already has a home in the format; this tab gathers it
 * rather than adding any. The film is the `project` row, the delivery
 * spec is `technical_specs`, and the title page is the screenplay's own
 * key/value title page (`screenplay_title_page`) — the one the Fountain
 * export writes at the top of the script, so what is typed here is what
 * the exported title page says. The project folder is the session's,
 * not the file's, and sits here because "where does this project live"
 * is a project question.
 */
export function ProjectWorkspace(): JSX.Element {
  return (
    <div className="ws project-ws">
      <ProjectSection />
      <TitlePageSection />
      <SpecsSection />
      <FolderSection />
    </div>
  );
}

// ---------------------------------------------------------------------------
// One-per-project rows
// ---------------------------------------------------------------------------

/**
 * The first live row of an entity the project has one of, and a way to
 * make it on the first keystroke — opening the tab creates nothing, so
 * an untouched spec stays absent rather than an empty row.
 */
function useSingleton(entity: string, defaultName: () => string): {
  row: Row | undefined; id: number | null; count: number;
  ensure: () => Promise<number>;
} {
  const rows = useQuery(
    `SELECT * FROM ${q(entity)} WHERE lifecycle_status IS NULL ` +
    "OR lifecycle_status <> 'cut' ORDER BY id");
  const creating = useRef<Promise<number> | null>(null);
  const row = rows[0];
  const ensure = (): Promise<number> => {
    if (creating.current === null) {
      creating.current = (async () => {
        await exec(`INSERT INTO ${q(entity)} (uuid, name) VALUES (?, ?)`,
                   [newUuid(), defaultName()]);
        const made = Number((await exec(
          "SELECT last_insert_rowid() AS id"))[0]?.["id"]);
        useStore.getState().noteWrite();
        return made;
      })();
    }
    return creating.current;
  };
  return { row, id: row === undefined ? null : Number(row["id"]),
           count: rows.length, ensure };
}

/** The visible fields of one registry tab, in registry order. */
function tabFields(entity: string, tab: string,
                   exclude: string[] = []): string[] {
  return (registry.entities.get(entity)?.fields ?? [])
    .filter((f) => f.tab === tab && f.hidden !== true &&
                   f.autoInjected !== true && !exclude.includes(f.name))
    .map((f) => f.name);
}

function Fields({ entity, names, single, grid = false }: {
  entity: string;
  names: string[];
  single: ReturnType<typeof useSingleton>;
  grid?: boolean;
}): JSX.Element {
  return (
    <div className={grid ? "ws-grid" : "ws-stack"}>
      {names.map((f) => entity === "project" && f === "numbering_policy"
        ? <NumberingPolicyField key={f} single={single}
                                value={(single.row?.[f] ?? null) as SqlValue} />
        : (
        <AutoField key={f} entity={entity} id={single.id}
                   ensure={single.ensure} field={f}
                   value={(single.row?.[f] ?? null) as never}
                   showHelp={false} />
      ))}
    </div>
  );
}

/**
 * `numbering_policy`, which is not saved by the select alone: every
 * change goes through NumberingPolicyConfirm, because what follows it
 * is every number in the production and there is no undo.
 */
function NumberingPolicyField({ single, value }: {
  single: ReturnType<typeof useSingleton>;
  value: SqlValue;
}): JSX.Element | null {
  const def = registry.entities.get("project")?.fields
    .find((f) => f.name === "numbering_policy");
  const [pending, setPending] = useState<NumberingPolicy | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  if (def === undefined) return null;
  // Absent means derived (spec §4.3), so choosing derived on a file with
  // no stored value changes nothing and asks nothing.
  const current = asPolicy(value) ?? DEFAULT_NUMBERING_POLICY;
  const id = "ws-project-numbering_policy";
  return (
    <div className="ws-field">
      <label htmlFor={id}>{def.label}</label>
      <Field def={def} value={current} inputId={id}
             onChange={(v) => {
               const next = asPolicy(v);
               if (next !== null && next !== current) setPending(next);
             }} />
      {failed !== null && <p className="ws-field-error" role="alert">{failed}</p>}
      {pending !== null && (
        <NumberingPolicyConfirm
          to={pending}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const to = pending;
            setPending(null);
            void (async () => {
              try {
                const target = single.id ?? await single.ensure();
                await setField(exec, registry, "project", target,
                               "numbering_policy", to);
                setFailed(null);
                useStore.getState().noteWrite();
              } catch (e) {
                setFailed(e instanceof Error ? e.message : String(e));
              }
            })();
          }} />
      )}
    </div>
  );
}

function ManyWarning({ count, what }: { count: number; what: string }):
    JSX.Element | null {
  if (count <= 1) return null;
  return (
    <p className="ws-field-error">
      This file has {count} {what} rows; these fields edit the first.
      Open Schema to merge them.
    </p>
  );
}

function ProjectSection(): JSX.Element {
  const projectName = useStore((s) => s.projectName);
  const single = useSingleton("project",
                              () => projectName ?? "Untitled project");
  // The prose — name, logline, synopsis — reads down the page; the short
  // facts sit in a grid beneath it.
  const prose = ["name", "logline", "synopsis"];
  const general = tabFields("project", "General", prose);
  return (
    <>
      <section className="ws-section">
        <h3>Project</h3>
        <p className="ws-section-note">
          The film itself: what it is called, what it is about in one
          line and then told short, and what kind of thing it is.
        </p>
        <ManyWarning count={single.count} what="project" />
        <div className="tp-layout">
          <Fields entity="project" names={prose} single={single} />
          <ProjectPoster single={single} />
        </div>
        <Fields entity="project" names={general} single={single} grid />
      </section>
      <section className="ws-section">
        <h3>Vision</h3>
        <Fields entity="project" names={tabFields("project", "Vision")}
                single={single} />
      </section>
    </>
  );
}

/**
 * The film's poster, beside the prose that describes it.
 *
 * An `asset_relationship` row from the project, typed `poster`
 * (proposal 0038), not a column: the first in §8.6's order is shown, and
 * one replaced stays behind it as an alternative. Fit to the column's
 * width, so any aspect ratio works.
 */
function ProjectPoster({ single }: {
  single: ReturnType<typeof useSingleton>;
}): JSX.Element {
  const { revision, openEntityRow, projectRoot, attachFolder } = useStore();
  const [posters, setPosters] = useState<MediaTile[] | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (single.id === null) { setPosters([]); return; }
    let cancelled = false;
    void loadPosters(exec, single.id).then((p) => {
      if (!cancelled) setPosters(p);
    }).catch((e: unknown) => fail("Could not read the poster", e));
    return () => { cancelled = true; };
  }, [single.id, revision]);

  const take = async (incoming: Incoming): Promise<void> => {
    try {
      const { assetIds, created } = await registerFiles(
        exec, incoming.candidates);
      const first = [...incoming.assetIds, ...assetIds][0];
      if (first === undefined) return;
      const projectId = single.id ?? await single.ensure();
      const change = await setPoster(exec, projectId, first);
      useStore.getState().recordChange(withCreatedAssets(change, created));
      setAdding(false);
    } catch (e) {
      fail("Could not set the poster", e);
    }
  };

  if (posters === null) return <div className="project-poster" />;
  const poster = posters[0];
  const identifier = poster?.asset["identifier"];
  const name = poster === undefined ? ""
    : String(poster.asset["name"] ?? identifier ?? "poster");

  return (
    <div className="project-poster">
      {poster !== undefined && (
        <>
          <div className="project-poster-image">
            {projectRoot === null ? (
              // The demo opens with no folder, and every asset reads
              // unresolved; say what would show it rather than that.
              <div className="asset-preview asset-preview-none">
                <p className="muted">
                  Connect the project folder to see the poster.
                </p>
                <button className="ghost tiny"
                        onClick={() => void attachFolder()}>
                  Connect folder
                </button>
              </div>
            ) : (
              <AssetPreview identifier={typeof identifier === "string"
                                        ? identifier : null} />
            )}
          </div>
          <div className="project-poster-bar">
            <span className="project-poster-name"
                  title={String(identifier ?? "")}>{name}</span>
            <button className="ghost tiny" aria-expanded={adding}
                    onClick={() => setAdding((v) => !v)}>Replace</button>
            <button className="ghost tiny" title="Show in Assets"
                    onClick={() => void openEntityRow(
                      "asset", Number(poster.asset["id"]))}>Open</button>
            <button className="ghost tiny"
                    title="Take it off the project. The asset stays."
                    onClick={() => void detachMedia(exec, poster)
                      .then((c) => useStore.getState().recordChange(c))
                      .catch((e: unknown) => fail("Could not remove it", e))}>
              Remove
            </button>
          </div>
        </>
      )}
      {(poster === undefined || adding) && (
        <div className="project-poster-add">
          {poster === undefined && <p>Poster</p>}
          <FileIntake compact onFiles={(i) => void take(i)}
                      exclude={new Set(posters.slice(0, 1)
                        .map((t) => Number(t.asset["id"])))} />
        </div>
      )}
    </div>
  );
}

function SpecsSection(): JSX.Element {
  const single = useSingleton("technical_specs", () => "Technical specs");
  return (
    <section className="ws-section">
      <h3>Technical specs</h3>
      <p className="ws-section-note">
        How the film is captured and delivered.
      </p>
      <ManyWarning count={single.count} what="technical specs" />
      <Fields entity="technical_specs"
              names={tabFields("technical_specs", "General", ["name"])}
              single={single} grid />
      <Fields entity="technical_specs"
              names={tabFields("technical_specs", "Notes")}
              single={single} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Title page
// ---------------------------------------------------------------------------

interface TitleKey {
  key: string;
  /** Other spellings a file may carry for the same slot. */
  aliases?: string[];
  multiline?: boolean;
  hint: string;
}

/** Fountain's title-page keys, in the order a title page reads. */
const TITLE_KEYS: TitleKey[] = [
  { key: "Title", hint: "THE FILM'S TITLE" },
  { key: "Credit", hint: "Written by" },
  { key: "Author", aliases: ["Authors"], hint: "Writer name(s)" },
  { key: "Source", hint: "Based on the novel by …" },
  { key: "Draft date", hint: "e.g. 7 October 2026" },
  { key: "Contact", multiline: true,
    hint: "Name\nAgency or address\nphone · email" },
  { key: "Copyright", hint: "© 2026 Name. All rights reserved." },
  { key: "Notes", multiline: true, hint: "Anything else for the page" },
];

const same = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

function slotOf(rows: Row[], k: TitleKey): Row | undefined {
  return rows.find((r) => [k.key, ...(k.aliases ?? [])]
    .some((name) => same(String(r["key"]), name)));
}

/**
 * Write one title-page key. An emptied key is removed rather than kept
 * blank: an exported `Draft date:` with nothing after it is a line on the
 * page that says nothing.
 */
async function writeTitleKey(k: TitleKey, value: string): Promise<void> {
  const rows = await exec(
    "SELECT id, key, sort_order FROM screenplay_title_page");
  const existing = slotOf(rows, k);
  if (value.trim() === "") {
    if (existing !== undefined) {
      await exec("DELETE FROM screenplay_title_page WHERE id = ?",
                 [Number(existing["id"])]);
    }
  } else if (existing !== undefined) {
    await exec("UPDATE screenplay_title_page SET value = ? WHERE id = ?",
               [value, Number(existing["id"])]);
  } else {
    // In its place in the standard order, not at the end: a Source added
    // later belongs under the author, not after the contact block. It
    // goes after the last row of a key that comes before it; the rows
    // after that move down one.
    const rank = (key: string): number => TITLE_KEYS.findIndex((t) =>
      [t.key, ...(t.aliases ?? [])].some((n) => same(n, key)));
    const mine = TITLE_KEYS.indexOf(k);
    const sorted = [...rows].sort((a, b) =>
      Number(a["sort_order"] ?? 0) - Number(b["sort_order"] ?? 0));
    const before = sorted.filter((r) => {
      const at = rank(String(r["key"]));
      return at >= 0 && at < mine;
    }).at(-1);
    const at = before === undefined
      ? (mine < 0 ? Math.max(-1, ...sorted.map((r) =>
          Number(r["sort_order"] ?? 0))) + 1 : 0)
      : Number(before["sort_order"] ?? 0) + 1;
    await exec("UPDATE screenplay_title_page SET sort_order = sort_order + 1 " +
               "WHERE sort_order >= ?", [at]);
    // Fountain keys are case-blind, but a page that says `title:` and
    // then `Copyright:` reads as two hands. Follow the file's own habit.
    const lower = rows.length > 0 && rows.every((r) => {
      const key = String(r["key"]);
      return key === key.toLowerCase();
    });
    await exec(
      "INSERT INTO screenplay_title_page (key, value, sort_order) " +
      "VALUES (?, ?, ?)", [lower ? k.key.toLowerCase() : k.key, value, at]);
  }
  useStore.getState().noteWrite();
}

const SETTLE_MS = 700;

/** One title-page key, saved as you type (like AutoField). */
function TitleField({ k, stored, placeholder }: {
  k: TitleKey; stored: string; placeholder?: string;
}): JSX.Element {
  const [local, setLocal] = useState(stored);
  const timer = useRef<number | null>(null);
  const focused = useRef(false);
  const latest = useRef(stored);
  const saved = useRef(stored);

  useEffect(() => {
    if (!focused.current && timer.current === null) {
      setLocal(stored);
      latest.current = stored;
      saved.current = stored;
    }
  }, [stored]);

  const commit = async (): Promise<void> => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (latest.current === saved.current) return;
    const next = latest.current;
    await writeTitleKey(k, next);
    saved.current = next;
  };
  // Leaving the tab mid-sentence still saves the sentence.
  useEffect(() => () => {
    if (timer.current !== null) void commit();
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const onChange = (v: string): void => {
    setLocal(v);
    latest.current = v;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void commit(), SETTLE_MS);
  };
  const id = `tp-${k.key.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className={"ws-field" + (k.multiline === true ? " ws-field-long" : "")}
         onFocus={() => { focused.current = true; }}
         onBlur={() => { focused.current = false; void commit(); }}>
      <label htmlFor={id}>{k.key}</label>
      {k.multiline === true
        ? <textarea id={id} rows={3} value={local}
                    placeholder={placeholder ?? k.hint}
                    onChange={(e) => onChange(e.target.value)} />
        : <input id={id} type="text" value={local}
                 placeholder={placeholder ?? k.hint}
                 onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

function TitlePageSection(): JSX.Element {
  const rows = useQuery(
    "SELECT id, key, value, sort_order FROM screenplay_title_page " +
    "ORDER BY sort_order, id");
  const project = useQuery(
    "SELECT name FROM project WHERE lifecycle_status IS NULL " +
    "OR lifecycle_status <> 'cut' ORDER BY id LIMIT 1");
  const projectTitle = String(project[0]?.["name"] ?? "");
  const value = (k: TitleKey): string =>
    String(slotOf(rows, k)?.["value"] ?? "");
  // Keys a file brought that are not one of the standard eight — kept,
  // exported, and shown so nothing on the page is invisible here.
  const others = rows.filter((r) =>
    !TITLE_KEYS.some((k) => slotOf([r], k) !== undefined));
  const title = TITLE_KEYS[0]!;

  return (
    <section className="ws-section">
      <h3>Title page</h3>
      <p className="ws-section-note">
        The script's title page. The Fountain export writes these at the
        top of the file; an empty field is left off the page.
      </p>
      <div className="tp-layout">
        <div className="ws-stack tp-fields">
          {value(title) === "" && projectTitle !== "" && (
            <button type="button" className="ghost tiny tp-fill"
                    onClick={() => void writeTitleKey(title, projectTitle)}>
              Use the project name, “{projectTitle}”, as the title
            </button>
          )}
          {TITLE_KEYS.map((k) => (
            <TitleField key={k.key} k={k} stored={value(k)} />
          ))}
          {others.map((r) => {
            const k: TitleKey = { key: String(r["key"]), hint: "",
              multiline: String(r["value"]).includes("\n") };
            return <TitleField key={`x:${String(r["id"])}`} k={k}
                               stored={String(r["value"] ?? "")} />;
          })}
        </div>
        <TitlePagePreview get={(key) =>
          value(TITLE_KEYS.find((k) => k.key === key)!)} />
      </div>
    </section>
  );
}

/**
 * Roughly how the page will print: title block centred a third of the
 * way down, contact and copyright bottom left, the draft bottom right.
 */
function TitlePagePreview({ get }: { get: (key: string) => string }):
    JSX.Element {
  const block = (key: string, cls = ""): JSX.Element | null => {
    const v = get(key);
    return v === "" ? null : <p className={`tp-${cls || "line"}`}>{v}</p>;
  };
  const empty = TITLE_KEYS.every((k) => get(k.key) === "");
  return (
    <div className="tp-preview" aria-label="Title page preview">
      {empty
        ? <p className="tp-empty">The title page is empty.</p>
        : <>
            <div className="tp-center">
              {block("Title", "title")}
              {block("Credit")}
              {block("Author")}
              {block("Source")}
            </div>
            <div className="tp-foot">
              <div>{block("Contact")}{block("Copyright")}</div>
              <div className="tp-foot-right">
                {block("Draft date")}{block("Notes")}
              </div>
            </div>
          </>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project folder
// ---------------------------------------------------------------------------

function FolderSection(): JSX.Element {
  const { projectRoot, rootPermission, rootTraversal, rootTraversalError,
          rootVerified, attachError, attachFolder, dismissAttachError,
          folderSupported, regrantRoot } = useStore();
  const name = (projectRoot as { name?: string } | null)?.name ?? null;

  let status: JSX.Element;
  if (projectRoot === null) {
    status = <p>No folder. Assets cannot resolve until the folder this
             .scf lives in is chosen.</p>;
  } else if (rootPermission !== "granted") {
    status = <p><strong>{name}</strong> — remembered, but this session
             lost permission to read it on reload.</p>;
  } else if (rootTraversal === "blocked") {
    status = <p className="ws-field-error"><strong>{name}</strong> —
             connected, but files cannot be reached through it on this
             machine. {rootTraversalError ?? ""}</p>;
  } else if (!rootVerified) {
    status = <p><strong>{name}</strong> — connected, but unverified:
             this session has no .scf on disk to check the folder
             against, so assets resolve against whatever is in it.</p>;
  } else {
    status = <p><strong>{name}</strong> — connected, and confirmed to
             hold this project's .scf.</p>;
  }

  return (
    <section className="ws-section">
      <h3>Project folder</h3>
      <p className="ws-section-note">
        The folder holding the .scf and the assets it points at. The same
        control as the topbar's folder button.
      </p>
      {status}
      <div className="project-folder-actions">
        {projectRoot !== null && rootPermission !== "granted" && (
          <button onClick={() => void regrantRoot()}>Reconnect folder</button>
        )}
        <button onClick={() => void attachFolder()}
                disabled={!folderSupported}
                title={folderSupported ? undefined
                  : "This browser cannot open folders."}>
          {projectRoot === null ? "Choose folder…" : "Change folder…"}
        </button>
      </div>
      {attachError !== null && (
        <p className="ws-field-error" role="alert">
          {attachError}{" "}
          <button className="ghost tiny" onClick={dismissAttachError}>
            dismiss
          </button>
        </p>
      )}
    </section>
  );
}
