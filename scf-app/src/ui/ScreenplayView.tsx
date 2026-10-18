// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { readScreenplay, type ScreenplayRows }
  from "@scf-core/screenplay/rowModel.ts";
import { exec, useStore } from "../state/store.ts";
import { useQuery } from "./useQuery.ts";
import { useRememberedOptions } from "./useRememberedOptions.ts";
import { rowsToBlocks } from "@scf-core/screenplay/blocks.ts";
import { suggestExportName } from "../state/saveName.ts";
import {
  BOLD, ITALIC, layoutScreenplay, runs, screenplayFdx, screenplayFountain,
  titleLayout, UNDERLINE, type LayoutOptions, type Page, type PageRow,
} from "../state/screenplayLayout.ts";

const OPTIONS_KEY = "scf:screenplay-options";

interface ScreenplayOptions extends LayoutOptions {
  titlePage: boolean;
  /** Scene numbers in both margins, the left only, or not at all. */
  sceneNumbers: "both" | "left" | "none";
  /** On-screen size only; print is always actual size. */
  zoom: number;
}

const DEFAULTS: ScreenplayOptions = {
  paper: "letter", showOutline: false, headingSpace: 1, autoContd: true,
  titlePage: true, sceneNumbers: "both", zoom: 1,
};

function withDefaults(saved: unknown): ScreenplayOptions {
  if (saved === null || typeof saved !== "object") return DEFAULTS;
  return { ...DEFAULTS, ...(saved as Partial<ScreenplayOptions>) };
}

function download(name: string, text: string, type: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * ScreenplayView — the script as it is sent out.
 *
 * Read-only, from the last commit (`screenplay_lines`, as the Script
 * tab's reader). Paged the way Final Draft pages: title page, Courier
 * 12pt on a fixed grid, numbered pages, scene numbers in the margins,
 * (MORE) and (CONT'D) across page breaks — so the page count here is
 * one a producer would recognise. Layout and pagination are in
 * `state/screenplayLayout.ts`; this only draws the rows it computed.
 *
 * Exports: FDX (Final Draft), Fountain (the same writer as the Script
 * tab's export), and PDF through the browser's print dialog, which
 * prints these pages exactly.
 */
export function ScreenplayView(): JSX.Element {
  const { projectName, revision } = useStore();
  const [opts, setOpts] = useRememberedOptions(OPTIONS_KEY, withDefaults);
  const [sp, setSp] = useState<ScreenplayRows | null>(null);
  const scenes = useQuery("SELECT id, scene_number FROM scene");

  useEffect(() => {
    let cancelled = false;
    void readScreenplay(exec).then((r) => { if (!cancelled) setSp(r); });
    return () => { cancelled = true; };
  }, [revision]);

  const sceneNumbers = useMemo(() => new Map(scenes
    .filter((s) => s["scene_number"] !== null && s["scene_number"] !== "")
    .map((s) => [Number(s["id"]), String(s["scene_number"])])), [scenes]);
  const blocks = useMemo(() => rowsToBlocks(sp?.lines ?? []), [sp]);
  const pages = useMemo(
    () => layoutScreenplay(blocks, sceneNumbers, opts),
    [blocks, sceneNumbers, opts.paper, opts.showOutline,   // eslint-disable-line react-hooks/exhaustive-deps
     opts.headingSpace, opts.autoContd]);
  const titlePage = sp?.titlePage ?? [];
  const showTitle = opts.titlePage && titlePage.length > 0;

  const docTitle = titlePage.find((t) => t.key.toLowerCase() === "title")
    ?.value.split("\n")[0] ?? projectName ?? "Screenplay";
  useEffect(() => {
    const was = document.title;
    const before = (): void => { document.title = docTitle; };
    const after = (): void => { document.title = was; };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, [docTitle]);

  const fountainName = suggestExportName(projectName);
  const empty = blocks.length === 0;

  return (
    <div className="screenplay print-surface">
      <style>{`@page { size: ${opts.paper}; margin: 0; }`}</style>
      <div className="sl-controls spv-controls">
        <div className="sl-controls-row">
          <span className="spv-count">
            {sp === null ? "Reading…"
              : `${String(pages.length)} page${pages.length === 1 ? "" : "s"}` +
                (showTitle ? " + title page" : "")}
          </span>
          <label className="sl-field">
            <span>Paper</span>
            <select value={opts.paper}
                    onChange={(e) => setOpts({
                      paper: e.target.value as ScreenplayOptions["paper"] })}>
              <option value="letter">US Letter</option>
              <option value="a4">A4</option>
            </select>
          </label>
          <label className="sl-field">
            <span>Zoom</span>
            <select value={String(opts.zoom)}
                    onChange={(e) => setOpts({ zoom: Number(e.target.value) })}>
              {[0.5, 0.75, 1, 1.25, 1.5].map((z) => (
                <option key={z} value={z}>{Math.round(z * 100)}%</option>
              ))}
            </select>
          </label>
          <span className="spv-export">
            <button disabled={empty}
                    title="Final Draft (.fdx)"
                    onClick={() => download(
                      fountainName.replace(/\.fountain$/, ".fdx"),
                      screenplayFdx(titlePage, blocks, sceneNumbers),
                      "application/xml")}>
              Export FDX
            </button>
            <button disabled={empty}
                    title="Fountain plain text (.fountain)"
                    onClick={() => download(fountainName,
                      screenplayFountain(titlePage, blocks), "text/plain")}>
              Export Fountain
            </button>
            <button className="primary" disabled={empty}
                    title="Opens the print dialog. Choose “Save as PDF” as the
destination for a PDF; set margins to None if the dialog offers them."
                    onClick={() => window.print()}>
              Print / Save PDF
            </button>
          </span>
        </div>
        <div className="sl-controls-row">
          <span className="sl-controls-label">Pages</span>
          <label className="sl-check">
            <input type="checkbox" checked={opts.titlePage}
                   onChange={(e) => setOpts({ titlePage: e.target.checked })} />
            Title page
          </label>
          <label className="sl-field">
            <span>Scene no.</span>
            <select value={opts.sceneNumbers}
                    onChange={(e) => setOpts({ sceneNumbers:
                      e.target.value as ScreenplayOptions["sceneNumbers"] })}>
              <option value="both">Both margins</option>
              <option value="left">Left margin</option>
              <option value="none">None</option>
            </select>
          </label>
          <label className="sl-check"
                 title="Two blank lines before each scene heading, rather than one">
            <input type="checkbox" checked={opts.headingSpace === 2}
                   onChange={(e) => setOpts({
                     headingSpace: e.target.checked ? 2 : 1 })} />
            Double space headings
          </label>
          <label className="sl-check"
                 title="A speaker who resumes after action in the same scene gets (CONT'D)">
            <input type="checkbox" checked={opts.autoContd}
                   onChange={(e) => setOpts({ autoContd: e.target.checked })} />
            Automatic (CONT'D)
          </label>
          <label className="sl-check"
                 title="Sections, synopses and notes — outline, not script. Off for a draft sent out.">
            <input type="checkbox" checked={opts.showOutline}
                   onChange={(e) => setOpts({ showOutline: e.target.checked })} />
            Outline and notes
          </label>
        </div>
      </div>

      {sp !== null && empty ? (
        <p className="muted sl-empty">
          No committed script yet. Write or import one in the Script tab
          and commit it; it appears here as pages.
        </p>
      ) : (
        <div className={`spv-pages spv-${opts.paper}`}
             style={{ zoom: opts.zoom }}>
          {showTitle && <TitlePageView rows={titlePage} />}
          {pages.map((p) => (
            <PageView key={p.number} page={p} numbers={opts.sceneNumbers} />
          ))}
        </div>
      )}
    </div>
  );
}

function TitlePageView({ rows }: {
  rows: ScreenplayRows["titlePage"];
}): JSX.Element {
  const t = titleLayout(rows);
  const block = (list: typeof t.center, cls: string): JSX.Element => (
    <div className={cls}>
      {list.map((e) => (
        <div key={e.key} className={`spv-tp-${e.key.replace(/\s+/g, "-")}`}>
          {e.lines.map((l, i) => <div key={i}><Inline text={l} /></div>)}
        </div>
      ))}
    </div>
  );
  return (
    <section className="spv-page spv-title-page" aria-label="Title page">
      {block(t.center, "spv-tp-center")}
      {block(t.left, "spv-tp-left")}
      {block(t.right, "spv-tp-right")}
    </section>
  );
}

/** A title-page value may carry emphasis too. */
function Inline({ text }: { text: string }): JSX.Element {
  const row: PageRow = {
    type: "action", space: 0, indent: 0,
    styled: { plain: text, styles: [] }, from: 0, to: text.length,
  };
  return <RowText row={row} />;
}

function RowText({ row }: { row: PageRow }): JSX.Element {
  return (
    <>
      {runs(row.styled, row.from, row.to).map((r, i) => {
        if (r.style === 0) return <span key={i}>{r.text}</span>;
        const style: CSSProperties = {
          fontWeight: r.style & BOLD ? 700 : undefined,
          fontStyle: r.style & ITALIC ? "italic" : undefined,
          textDecoration: r.style & UNDERLINE ? "underline" : undefined,
        };
        return <span key={i} style={style}>{r.text}</span>;
      })}
    </>
  );
}

function PageView({ page, numbers }: {
  page: Page; numbers: ScreenplayOptions["sceneNumbers"];
}): JSX.Element {
  return (
    <section className="spv-page" aria-label={`Page ${String(page.number)}`}>
      {/* Page 1 carries no number, by convention. */}
      {page.number > 1 && <span className="spv-page-no">{page.number}.</span>}
      <div className="spv-body">
        {page.rows.map((r, i) => (
          <div key={i}
               className={`spv-row spv-${r.type}` +
                          (r.synthetic === true ? " spv-synthetic" : "")}
               style={{
                 marginTop: r.space > 0 ? `${String(r.space * 12)}pt` : undefined,
                 paddingLeft: `${String(r.indent / 10)}in`,
               }}>
            {r.sceneNumber !== undefined && numbers !== "none" && (
              <span className="spv-scene-no spv-scene-no-left">{r.sceneNumber}</span>
            )}
            <RowText row={r} />
            {r.sceneNumber !== undefined && numbers === "both" && (
              <span className="spv-scene-no spv-scene-no-right">{r.sceneNumber}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
