// SPDX-License-Identifier: Apache-2.0
/**
 * MediaChecksPanel — media that looks authored and resolves for nobody.
 *
 * The Assets tab already shows §8.6 orphans. This is the level above:
 * the bundle graph around the assets. Each list comes from
 * `editor/mediaChecks.ts` and each entry gets a verb — open the row, or
 * for the two mechanical repairs (a spelling, a comma list in a JSON
 * field) apply it. Nothing changes until the author clicks
 * (conventions §1: SCF reports, it does not enforce).
 */

import { useEffect, useState } from "react";
import { q } from "@scf-core/db.ts";
import {
  EMPTY_MEDIA_REPORT, mediaFindingCount, scanMedia, type MediaReport,
} from "../editor/mediaChecks.ts";
import { exec, registry, useStore } from "../state/store.ts";

/** Loads the report; shared by the toggle's count and the panel. */
export function useMediaReport(): MediaReport {
  const { revision } = useStore();
  const [report, setReport] = useState<MediaReport>(EMPTY_MEDIA_REPORT);
  useEffect(() => {
    void (async () => setReport(await scanMedia(exec, registry)))();
  }, [revision]);
  return report;
}

export function MediaChecksPanel({ report }: {
  report: MediaReport;
}): JSX.Element {
  const { openEntityRow, noteWrite } = useStore();

  const act = (sql: string, params: (string | number)[]): void => {
    void (async () => {
      await exec(sql, params);
      noteWrite();
    })();
  };

  if (mediaFindingCount(report) === 0) {
    return (
      <div className="media-checks">
        <p className="muted">
          Every bundle reaches a subject, bindings are scoped or baseline,
          and nothing looks misfiled.
        </p>
      </div>
    );
  }

  return (
    <div className="media-checks">
      {report.unboundBundles.length > 0 && (
        <section>
          <h4>Bundles bound to nothing ({report.unboundBundles.length})</h4>
          <p className="help">
            Their assets are referenced, so they are not orphans — and no
            media query at any scene will return them. Open one and use
            “Bind to…”.
          </p>
          <ul>
            {report.unboundBundles.map((b) => (
              <li key={b.id}>
                <button className="ghost tiny"
                        onClick={() => { void openEntityRow("bundle", b.id); }}>
                  {b.name ?? `#${b.id}`}
                </button>
                <span className="muted">
                  {b.intent ?? "no intent"} · {b.assetCount} asset
                  {b.assetCount === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.everywhereBindings.length > 0 && (
        <section>
          <h4>Bindings in force at every scene
            ({report.everywhereBindings.length})</h4>
          <p className="help">
            Not a baseline and no scene range, so this applies everywhere
            anyway — a “Scene 03” bundle bound this way also answers for
            scene 19. Give it a range, or mark it baseline if that is
            what it is.
          </p>
          <ul>
            {report.everywhereBindings.map((b) => (
              <li key={`${b.entity}-${b.id}`}>
                <button className="ghost tiny"
                        onClick={() => { void openEntityRow(b.entity, b.id); }}>
                  {b.name ?? `${b.entity} #${b.id}`}
                </button>
                <span className="muted">
                  {b.subjectName ?? b.subjectType} → {b.bundleName ?? "?"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.duplicateBindings.length > 0 && (
        <section>
          <h4>Duplicate bindings ({report.duplicateBindings.length})</h4>
          <p className="help">
            The same subject, bundle and scene range, bound more than once.
            Often a second binding meant for a different bundle.
          </p>
          <ul>
            {report.duplicateBindings.map((group) => (
              <li key={group.map((b) => b.id).join("-")}>
                <span className="muted">
                  {group[0]?.subjectName} → {group[0]?.bundleName}:
                </span>
                {group.map((b) => (
                  <button key={b.id} className="ghost tiny"
                          onClick={() => {
                            void openEntityRow(b.entity, b.id);
                          }}>
                    {b.name ?? `#${b.id}`}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.intentConflicts.length > 0 && (
        <section>
          <h4>Wrong kind for the bundle's intent
            ({report.intentConflicts.length})</h4>
          <ul>
            {report.intentConflicts.map((c) => (
              <li key={`${c.bundleId}-${c.assetId}`}>
                <button className="ghost tiny"
                        onClick={() => {
                          void openEntityRow("bundle", c.bundleId);
                        }}>
                  {c.bundleName ?? `#${c.bundleId}`}
                </button>
                <span>{c.assetName ?? `#${c.assetId}`}</span>
                <span className="muted">{c.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.lookalikes.map((field) => (
        <section key={`${field.entity}.${field.field}`}>
          <h4>
            One value, several spellings —{" "}
            <span className="mono">{field.entity}.{field.field}</span>
          </h4>
          <ul>
            {field.groups.map((group) => {
              const keep = group[0];
              return (
                <li key={group.map((g) => g.value).join("|")}>
                  {group.map((g, i) => (
                    <span key={g.value}
                          className={i === 0 ? "" : "muted"}>
                      “{g.value}” ×{g.count}
                    </span>
                  ))}
                  {keep !== undefined && (
                    <button className="ghost tiny"
                            title={`Rewrite the other spellings to “${
                              keep.value}”`}
                            onClick={() => act(
                              `UPDATE ${q(field.entity)} SET ${q(field.field)} = ? ` +
                              `WHERE ${q(field.field)} IN (${group.slice(1)
                                .map(() => "?").join(", ")})`,
                              [keep.value, ...group.slice(1).map((g) => g.value)])}>
                      use “{keep.value}”
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {report.invalidJson.length > 0 && (
        <section>
          <h4>JSON fields that do not hold JSON
            ({report.invalidJson.length})</h4>
          <p className="help">
            Readers parse these columns. A comma list stored as text
            reads as one string, or fails.
          </p>
          <ul>
            {report.invalidJson.map((j) => (
              <li key={`${j.entity}-${j.field}-${j.id}`}>
                <button className="ghost tiny"
                        onClick={() => { void openEntityRow(j.entity, j.id); }}>
                  {j.entity} #{j.id}
                </button>
                <span className="mono">{j.field}</span>
                <span className="mono muted">{j.value}</span>
                {j.suggestion !== null && (
                  <button className="ghost tiny"
                          title={j.suggestion}
                          onClick={() => act(
                            `UPDATE ${q(j.entity)} SET ${q(j.field)} = ? ` +
                            `WHERE id = ?`, [j.suggestion as string, j.id])}>
                    make it a list
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
