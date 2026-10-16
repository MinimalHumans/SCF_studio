// SPDX-License-Identifier: Apache-2.0
/**
 * report.ts — the serialised form of a validation run. Spec §9.6.
 *
 * `collectFindings` answers what is wrong with a file. This turns that
 * answer into something that leaves the process: a JSON document a
 * third party can parse, diff between runs, and check into CI as a
 * baseline.
 *
 * The format carries its own version, separate from both the spec and
 * the schema. A consumer parsing a report needs to know how to read the
 * REPORT, which changes for reasons that have nothing to do with the
 * format being reported on — a new optional field here does not mean
 * SCF changed.
 *
 * Everything in a report is either stable or explicitly volatile.
 * `generatedAt` is the only field that differs between two runs over an
 * unchanged file, and it is omitted by default for exactly that reason:
 * a report you cannot diff is a report you cannot use as a baseline.
 */

import type { Registry } from "./registry.ts";
import type { SqlExec } from "./db.ts";
import {
  FINDING_CATALOG, collectFindings, type Finding, type FindingSeverity,
} from "./findings.ts";

/** Bumped when the report SHAPE changes, not when SCF does. */
export const REPORT_FORMAT_VERSION = "1.0";

export interface ReportFinding extends Finding {
  /** The specification section this finding derives from. */
  spec: string;
  /** The catalog's one-line title, so a report reads without the code. */
  title: string;
}

export interface ValidationReport {
  reportFormat: string;
  /** What the tool was built against. */
  toolSchemaVersion: string;
  /** What the FILE says it is. Null when unstamped. */
  fileSchemaVersion: string | null;
  /** Identifies the file being reported on, never its contents. */
  source: string;
  counts: Record<FindingSeverity, number>;
  clean: boolean;
  findings: ReportFinding[];
  /** ISO 8601. Omitted unless explicitly requested — see the header. */
  generatedAt?: string;
}

/**
 * One finding per condition per table (§9.5): every finding of one code
 * on one table becomes one, its `rowIds` the sorted union, its `count`
 * the sum, so a validator that reports per row and one that reports per
 * table publish the same report. In first-seen order. The editor's
 * panels keep `collectFindings`' per-row findings; this is the published
 * form.
 */
export function oneConditionOneFinding(findings: Finding[]): Finding[] {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = `${f.code}\u0000${f.table ?? ""}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [f]); else group.push(f);
  }
  return [...groups.values()].map((group) => {
    const first = group[0] as Finding;
    if (group.length === 1) return first;
    return {
      ...first,
      rowIds: [...new Set(group.flatMap((f) => f.rowIds))]
        .sort((a, b) => a - b),
      count: group.reduce((n, f) => n + f.count, 0),
      message: `${first.message} And ${String(group.length - 1)} more ` +
               "like it.",
    };
  });
}

export interface ReportOptions {
  /** Path or label for the file. Appears verbatim in `source`. */
  source: string;
  /** Include `generatedAt`. Off by default so reports stay diffable. */
  timestamp?: boolean;
}

export async function validationReport(
    exec: SqlExec, registry: Registry,
    opts: ReportOptions): Promise<ValidationReport> {
  const collected = await collectFindings(exec, registry);
  const findings: ReportFinding[] = oneConditionOneFinding(
    collected.findings).map((f) => ({
    ...f,
    spec: FINDING_CATALOG[f.code].spec,
    title: FINDING_CATALOG[f.code].title,
  }));
  const counts: Record<FindingSeverity, number> =
    { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;

  const report: ValidationReport = {
    reportFormat: REPORT_FORMAT_VERSION,
    toolSchemaVersion: registry.schemaVersion,
    fileSchemaVersion: collected.schemaVersion,
    source: opts.source,
    counts,
    clean: collected.clean,
    findings,
  };
  if (opts.timestamp === true) report.generatedAt = new Date().toISOString();
  return report;
}

const MARK: Record<FindingSeverity, string> = {
  error: "error  ", warning: "warning", info: "info   ",
};

/**
 * Human-readable rendering. Grouped by severity, in the same order the
 * JSON uses, so the two never tell different stories.
 */
export function renderReport(report: ValidationReport): string {
  const lines: string[] = [];
  const version = report.fileSchemaVersion ?? "unstamped";
  lines.push(`${report.source}  (schema ${version})`);

  if (report.findings.length === 0) {
    lines.push("");
    lines.push("  no findings");
    return `${lines.join("\n")}\n`;
  }

  lines.push("");
  let severity: FindingSeverity | null = null;
  for (const f of report.findings) {
    if (f.severity !== severity) {
      if (severity !== null) lines.push("");
      severity = f.severity;
    }
    const where = f.table === null
      ? ""
      : f.rowIds.length === 0
        ? `  [${f.table}]`
        : `  [${f.table} ${f.rowIds.join(",")}]`;
    lines.push(`  ${MARK[f.severity]}  ${f.code}${where}`);
    lines.push(`           ${f.message}`);
  }

  lines.push("");
  lines.push(
    `  ${String(report.counts.error)} error, ` +
    `${String(report.counts.warning)} warning, ` +
    `${String(report.counts.info)} info`);

  // The distinction spec §9.1 rests on, said out loud rather than left
  // for the reader to infer from the exit code.
  lines.push(report.clean
    ? "  This file is readable. Findings above are worth fixing, none " +
      "prevent reading."
    : "  Errors mean two conforming readers would disagree about what " +
      "this file says.");
  return `${lines.join("\n")}\n`;
}
