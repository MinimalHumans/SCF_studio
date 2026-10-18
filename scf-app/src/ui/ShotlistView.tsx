// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo } from "react";
import type { Row } from "@scf-core/db.ts";
import { useStore } from "../state/store.ts";
import { useRead } from "./useQuery.ts";
import { ShotFrame, useShotFrames } from "./ShotFrame.tsx";
import { useRememberedOptions } from "./useRememberedOptions.ts";
import { sceneLabel } from "@scf-core/displayName.ts";
import {
  actionText, beatBanner, buildSheets, COLUMN_LABEL, runningTime,
  seconds, shortAngle, shortSize, SHOTLIST_COLUMNS, sizeLegend, tidy,
  withDefaults, type SceneSheet, type ShotlistColumn, type ShotlistOptions,
  readShotlistRows, type ShotlistRows,
} from "@scf-core/shotlist.ts";

/** Before the first read lands, and when one fails. */
const EMPTY_ROWS: ShotlistRows = {
  scenes: [], beats: [], shots: [], locations: [], lighting: [],
  sceneCast: [], sceneProps: [], shotCast: [], shotProps: [],
};

const OPTIONS_KEY = "scf:shotlist-options";

/** Group rows by a numeric key, keeping their order. */
function groupNames(rows: Row[], keyField: string,
                    nameField = "name"): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const r of rows) {
    const k = Number(r[keyField]);
    const name = String(r[nameField] ?? "").trim();
    if (name === "") continue;
    const list = out.get(k) ?? [];
    if (!list.includes(name)) list.push(name);
    out.set(k, list);
  }
  return out;
}

/**
 * ShotlistView — the shot list, as paper.
 *
 * Read-only. The Shoot tab writes the shots and beats; this lays them
 * out the way a crew is handed them — storyboard frame, shot code,
 * size, angle, lens, move, seconds, the action, a box to tick — and
 * prints through the browser, which is also the PDF export ("Save as
 * PDF" in the print dialog), so what is on screen is what is printed.
 *
 * Which columns, which scenes, the page and what sits around the table
 * are choices in the bar above the sheet, remembered per browser.
 */
export function ShotlistView(): JSX.Element {
  const { projectName } = useStore();
  const [opts, setOpts] = useRememberedOptions(OPTIONS_KEY, withDefaults);

  const { scenes, beats, shots, locations, lighting, sceneCast, sceneProps,
          shotCast, shotProps } = useRead(readShotlistRows, EMPTY_ROWS);
  const frameOf = useShotFrames();
  const locationById = useMemo(
    () => new Map(locations.map((l) => [Number(l["id"]), l])), [locations]);
  const lightOf = useMemo(() => {
    const m = new Map<number, Row>();
    for (const l of lighting) {
      const id = Number(l["scene_id"]);
      if (!m.has(id)) m.set(id, l);
    }
    return m;
  }, [lighting]);
  const castOfScene = useMemo(() => groupNames(sceneCast, "scene_id"), [sceneCast]);
  const propsOfScene = useMemo(() => groupNames(sceneProps, "scene_id"), [sceneProps]);
  const castOfShot = useMemo(() => groupNames(shotCast, "shot_id"), [shotCast]);
  const propsOfShot = useMemo(() => groupNames(shotProps, "shot_id"), [shotProps]);

  const sheets = useMemo(
    () => buildSheets(scenes, beats, shots, opts),
    [scenes, beats, shots, opts]);
  // A scene picked earlier that has since lost its shots, or belongs to
  // another project: fall back to everything rather than a blank page.
  const scopeValid = opts.scope === "all" ||
    scenes.some((s) => String(s["id"]) === opts.scope);
  useEffect(() => {
    if (!scopeValid && scenes.length > 0) setOpts({ scope: "all" });
  }, [scopeValid, scenes.length]);  // eslint-disable-line react-hooks/exhaustive-deps

  const scenesWithShots = useMemo(() => {
    const has = new Set(shots.map((s) => Number(s["scene_id"])));
    return scenes.filter((s) => has.has(Number(s["id"])));
  }, [scenes, shots]);

  const columns = SHOTLIST_COLUMNS.filter((c) => opts.columns[c]);
  const title = opts.scope === "all" || sheets.length !== 1
    ? `${projectName ?? "Untitled"} — Shot List`
    : `${projectName ?? "Untitled"} — Scene ${
        String(sheets[0]!.scene["scene_number"] ?? "")} Shot List`;
  const today = new Date().toLocaleDateString(undefined,
    { day: "numeric", month: "short", year: "numeric" });
  const totalShots = sheets.reduce((n, s) => n + s.shotCount, 0);
  const totalSecs = sheets.reduce((n, s) => n + s.seconds, 0);
  const allTimed = sheets.every((s) => s.allTimed);

  // The PDF takes its file name from the document title.
  useEffect(() => {
    const was = document.title;
    const before = (): void => { document.title = title; };
    const after = (): void => { document.title = was; };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, [title]);

  const usedSizes = opts.abbreviate && opts.columns.size
    ? sizeLegend(sheets.flatMap((s) => s.groups.flatMap((g) =>
        g.shots.map((r) => shortSize(r["shot_size"] as string | null)))))
    : [];

  const cell = (c: ShotlistColumn, shot: Row): JSX.Element => {
    const id = Number(shot["id"]);
    const cut = shot["lifecycle_status"] === "cut";
    switch (c) {
      case "frame":
        return <td key={c} className="sl-c-frame">
          <ShotFrame className="sl-frame"
                     identifier={frameOf.get(id) ?? null}
                     alt={String(shot["shot_number"] ?? "")} />
        </td>;
      case "shot":
        return <td key={c} className="sl-c-shot">
          {String(shot["shot_number"] ?? "")}
          {cut && <span className="sl-cut">cut</span>}
        </td>;
      case "title":
        return <td key={c} className="sl-c-title">{String(shot["name"] ?? "")}</td>;
      case "size": {
        const v = shot["shot_size"] as string | null;
        return <td key={c} className="sl-c-size">
          {opts.abbreviate ? shortSize(v) : tidy(v)}</td>;
      }
      case "angle": {
        const v = shot["camera_angle"] as string | null;
        return <td key={c} className="sl-c-angle">
          {opts.abbreviate ? shortAngle(v) : tidy(v)}</td>;
      }
      case "lens":
        return <td key={c} className="sl-c-lens">{tidy(shot["lens_choice"])}</td>;
      case "move":
        return <td key={c} className="sl-c-move">{tidy(shot["camera_movement"])}</td>;
      case "sec":
        return <td key={c} className="sl-c-sec">{seconds(shot["duration_seconds"])}</td>;
      case "action":
        return <td key={c} className="sl-c-action">
          {actionText(shot, opts.columns.title)}</td>;
      case "cast":
        return <td key={c} className="sl-c-cast">
          {(castOfShot.get(id) ?? []).join(", ")}</td>;
      case "props":
        return <td key={c} className="sl-c-props">
          {(propsOfShot.get(id) ?? []).join(", ")}</td>;
      case "notes":
        return <td key={c} className="sl-c-notes">{String(shot["notes"] ?? "")}</td>;
      case "done":
        return <td key={c} className="sl-c-done"><span className="sl-box" /></td>;
    }
  };

  const sceneHeader = (sheet: SceneSheet): JSX.Element | null => {
    if (!opts.sceneHeader) return null;
    const sceneId = Number(sheet.scene["id"]);
    const loc = locationById.get(Number(sheet.scene["location_id"]));
    const light = lightOf.get(sceneId);
    const locText = loc === undefined ? "" : [
      String(loc["name"] ?? ""),
      [loc["setting"], loc["key_features"]]
        .filter((v) => v !== null && v !== undefined && v !== "")
        .map(String).join(". "),
    ].filter((s) => s !== "").join(": ");
    const lightText = light === undefined ? "" : [
      light["overall_mood"],
      light["key_source"] ? `Key: ${String(light["key_source"])}` +
        (light["light_quality"] ? ` (${String(light["light_quality"])})` : "")
        : null,
      light["overall_mood"] ? null : tidy(light["lighting_style"]),
    ].filter((v) => v !== null && v !== undefined && v !== "")
      .map(String).join(" ");
    const cast = castOfScene.get(sceneId) ?? [];
    const props = propsOfScene.get(sceneId) ?? [];
    const blocks: Array<[string, string]> = [
      ["Location", locText],
      ["Light", lightText],
      ["Cast", cast.join(", ")],
      ["Props", props.join(", ")],
    ].filter((b): b is [string, string] => b[1] !== "");
    if (blocks.length === 0) return null;
    return (
      <div className="sl-scene-facts">
        {blocks.map(([k, v]) => (
          <div key={k}>
            <span className="sl-label">{k}</span>
            <p>{v}</p>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="shotlist print-surface">
      <style>{`@page { size: ${opts.paper} ${opts.orientation}; margin: 10mm; }`}</style>
      <ShotlistControls opts={opts} setOpts={setOpts}
                        scenes={scenesWithShots} />

      {sheets.length === 0 ? (
        <p className="muted sl-empty">
          No shots to list yet. Shots are planned in Shoot; once a scene
          has some, they appear here.
        </p>
      ) : (
        <div className={`sl-sheet sl-${opts.paper} sl-${opts.orientation}` +
                        (opts.pagePerScene ? " sl-page-per-scene" : "")}>
          <header className="sl-doc-head">
            <h1>{title}</h1>
            <span className="sl-doc-meta">
              {sheets.length === 1
                ? `${String(sheets[0]!.scene["name"] ?? "")}  ·  ` : ""}
              {totalShots} shot{totalShots === 1 ? "" : "s"}
              {totalSecs > 0 &&
                `  ·  ${allTimed ? "" : "≥ "}${runningTime(totalSecs)}`}
              {`  ·  ${today}`}
            </span>
          </header>

          {sheets.map((sheet) => (
            <section key={String(sheet.scene["id"])} className="sl-scene">
              {sheets.length > 1 && (
                <h2 className="sl-scene-head">
                  <span>{sceneLabel(sheet.scene).replace(/^sc /, "Scene ")}</span>
                  <span className="sl-scene-meta">
                    {sheet.shotCount} shot{sheet.shotCount === 1 ? "" : "s"}
                    {sheet.seconds > 0 &&
                      `  ·  ${sheet.allTimed ? "" : "≥ "}${runningTime(sheet.seconds)}`}
                  </span>
                </h2>
              )}
              {sceneHeader(sheet)}
              <table className="sl-table">
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c} className={`sl-c-${c}`}>{COLUMN_LABEL[c]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sheet.groups.flatMap((g, gi) => {
                    const banner = beatBanner(g);
                    return [
                      ...(banner === null ? [] : [
                        <tr key={`beat-${String(gi)}`} className="sl-beat">
                          <td colSpan={columns.length}>{banner}</td>
                        </tr>,
                      ]),
                      ...g.shots.map((shot) => (
                        <tr key={String(shot["id"])}
                            className={shot["lifecycle_status"] === "cut"
                              ? "sl-row-cut" : undefined}>
                          {columns.map((c) => cell(c, shot))}
                        </tr>
                      )),
                    ];
                  })}
                </tbody>
              </table>
            </section>
          ))}

          {opts.legend && usedSizes.length > 0 && (
            <footer className="sl-legend">
              <span className="sl-label">Sizes</span>{" "}
              {usedSizes.map(([s, long]) => `${s} ${long}`).join(", ")}.
            </footer>
          )}
        </div>
      )}
    </div>
  );
}

function ShotlistControls({ opts, setOpts, scenes }: {
  opts: ShotlistOptions;
  setOpts: (p: Partial<ShotlistOptions>) => void;
  scenes: Row[];
}): JSX.Element {
  const check = (label: string, value: boolean,
                 on: (v: boolean) => void, title?: string): JSX.Element => (
    <label className="sl-check" title={title}>
      <input type="checkbox" checked={value}
             onChange={(e) => on(e.target.checked)} />
      {label}
    </label>
  );
  return (
    <div className="sl-controls">
      <div className="sl-controls-row">
        <label className="sl-field">
          <span>Scenes</span>
          <select value={opts.scope}
                  onChange={(e) => setOpts({ scope: e.target.value })}>
            <option value="all">All scenes with shots</option>
            {scenes.map((s) => (
              <option key={String(s["id"])} value={String(s["id"])}>
                {sceneLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="sl-field">
          <span>Page</span>
          <select value={opts.orientation}
                  onChange={(e) => setOpts({
                    orientation: e.target.value as ShotlistOptions["orientation"] })}>
            <option value="landscape">Landscape</option>
            <option value="portrait">Portrait</option>
          </select>
          <select value={opts.paper}
                  onChange={(e) => setOpts({
                    paper: e.target.value as ShotlistOptions["paper"] })}>
            <option value="letter">US Letter</option>
            <option value="a4">A4</option>
          </select>
        </label>
        <button className="primary sl-print" onClick={() => window.print()}
                title="Opens the print dialog. Choose “Save as PDF” as the
destination for a PDF.">
          Print / Save PDF
        </button>
      </div>
      <div className="sl-controls-row">
        <span className="sl-controls-label">Columns</span>
        {SHOTLIST_COLUMNS.map((c) => (
          <span key={c}>
            {check(COLUMN_LABEL[c], opts.columns[c], (v) =>
              setOpts({ columns: { ...opts.columns, [c]: v } }))}
          </span>
        ))}
      </div>
      <div className="sl-controls-row">
        <span className="sl-controls-label">Layout</span>
        {check("Group by beat", opts.groupByBeat,
               (v) => setOpts({ groupByBeat: v }))}
        {check("Scene facts", opts.sceneHeader,
               (v) => setOpts({ sceneHeader: v }),
               "Location, light, cast and props above each scene")}
        {check("Short forms", opts.abbreviate,
               (v) => setOpts({ abbreviate: v }),
               "ECU, MCU, MW … for shot sizes")}
        {check("Size legend", opts.legend, (v) => setOpts({ legend: v }))}
        {check("New page per scene", opts.pagePerScene,
               (v) => setOpts({ pagePerScene: v }))}
        {check("Include cut shots", opts.includeCut,
               (v) => setOpts({ includeCut: v }),
               "Cut shots keep their numbers; listed, they are marked cut")}
      </div>
    </div>
  );
}
