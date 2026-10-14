// SPDX-License-Identifier: Apache-2.0
/**
 * assetStanding.ts — whether a file is current or history, at a glance.
 *
 * Two facts combine: the asset's `lifecycle_status`, and whether
 * anything points at it. Six statuses collapse to two kinds a reader
 * cares about:
 *
 *   current   `active`, `draft` (or unset) — the version meant now.
 *   historic  `superseded`, `cut`, `archived`, `deprecated` — kept for
 *             the record.
 *
 * "Historic" is an editorial reading, not a resolution rule. §6.6.1
 * excludes only `cut`: a superseded storyboard still attached to a shot
 * is still that shot's storyboard to anything that reads it. That case
 * is the one worth shouting about, so it gets its own warning rather
 * than being dimmed along with the rest.
 *
 * Headless, so the rule is testable without a view.
 */

export type StandingKind =
  | "in-use" | "unreferenced"
  | "superseded" | "cut" | "archived" | "deprecated";

export interface Standing {
  kind: StandingKind;
  /** Kept for the record rather than meant now. */
  historic: boolean;
  /** Historic, yet something still points at it. */
  stillAttached: boolean;
  label: string;
  title: string;
}

const HISTORIC: Record<string, StandingKind> = {
  superseded: "superseded", cut: "cut",
  archived: "archived", deprecated: "deprecated",
};

const WHY: Record<Exclude<StandingKind, "in-use" | "unreferenced">,
                  string> = {
  superseded: "Replaced by a newer version",
  cut: "Cut: not in the film",
  archived: "Archived: kept for the record, not in the working film",
  deprecated: "Deprecated: kept for compatibility, not for new work",
};

/**
 * @param referenced  whether any row points at the asset.
 * @param successor   the replacing asset's name, for a superseded one.
 */
export function assetStanding(status: string | null | undefined,
                              referenced: boolean,
                              successor: string | null = null): Standing {
  const kind = HISTORIC[status ?? ""];
  if (kind === undefined) {
    return referenced
      ? { kind: "in-use", historic: false, stillAttached: false,
          label: "in use", title: "Current, and something points at it." }
      : { kind: "unreferenced", historic: false, stillAttached: false,
          label: "unreferenced",
          title: "Current, but nothing points at it: no bundle, anchor " +
                 "or relationship." };
  }
  let title = WHY[kind as keyof typeof WHY];
  if (kind === "superseded" && successor !== null) {
    title = `Replaced by ${successor}`;
  }
  if (referenced) {
    title += kind === "cut"
      ? ". Still attached somewhere; detach it or restore it."
      : ". Still attached somewhere, so anything reading that shot, " +
        "scene or bundle still gets this version.";
  } else {
    title += ". Nothing points at it; it is history.";
  }
  return { kind, historic: true, stillAttached: referenced,
           label: kind === "superseded" && successor !== null
             ? `superseded → ${successor}` : kind,
           title };
}
