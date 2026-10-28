// SPDX-License-Identifier: Apache-2.0
/**
 * auditFormat.ts — what the audit viewer shows, apart from showing it:
 * the filter the controls describe, and how an event reads in a row.
 */

import type { AuditActor, AuditFilter, AuditScope } from "@scf-host/auditStore.ts";

export type AuditRange = "hour" | "day" | "week" | "all";

/** What the viewer's controls say, before it is a query. */
export interface AuditControls {
  scope: "" | AuditScope;
  actor: "" | AuditActor;
  /** A project's path, or "" for all. */
  project: string;
  search: string;
  range: AuditRange;
  /** Open, close and reload events, which bury the changes. */
  showLifecycle: boolean;
  /** Only the events on one row, by uuid. */
  targetUuid: string | null;
}

export const NO_CONTROLS: AuditControls = {
  scope: "", actor: "", project: "", search: "", range: "all",
  showLifecycle: false, targetUuid: null,
};

const RANGE_MS: Record<Exclude<AuditRange, "all">, number> = {
  hour: 3_600_000, day: 86_400_000, week: 7 * 86_400_000,
};

export function buildFilter(c: AuditControls, now: Date): AuditFilter {
  const search = c.search.trim();
  return {
    ...(c.scope === "" ? {} : { scope: c.scope }),
    ...(c.actor === "" ? {} : { actorKind: c.actor }),
    ...(c.project === "" ? {} : { projectPath: c.project }),
    ...(search === "" ? {} : { search }),
    ...(c.range === "all" ? {} : {
      since: new Date(now.getTime() - RANGE_MS[c.range]).toISOString() }),
    ...(c.showLifecycle ? {} : { hideLifecycle: true }),
    ...(c.targetUuid === null ? {} : { targetUuid: c.targetUuid }),
  };
}

const ACTIONS: Record<string, string> = {
  "project.open": "Opened project",
  "project.close": "Closed project",
  "project.create": "Created project",
  "project.saveAs": "Saved as a new file",
  "project.reload": "Reloaded from disk",
  "file.external_change": "File changed outside the editor",
  "record.create": "Created",
  "record.update": "Updated",
  "record.delete": "Deleted",
};

/** A readable name for an action, or the action itself if it has none. */
export function actionLabel(action: string): string {
  const bare = action.replace(/^(op|call)\./, "");
  return ACTIONS[bare] ?? ACTIONS[action] ?? action;
}

const pad = (n: number): string => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug",
                "Sep", "Oct", "Nov", "Dec"];

/** Local time; the date too when it is not today. */
export function formatTime(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${
    pad(d.getSeconds())}`;
  const today = d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return today ? time : `${MONTHS[d.getMonth()]!} ${String(d.getDate())} ${time}`;
}

/** The file name of a path in either spelling. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter((p) => p !== "").pop() ?? path;
}

export function shortUuid(uuid: string): string {
  return uuid.slice(0, 8);
}
