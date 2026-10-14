// SPDX-License-Identifier: Apache-2.0
import type { Standing } from "../editor/assetStanding.ts";

/**
 * The small tag that says whether a file is current or history
 * (assetStanding.ts). A historic file that is still attached gets the
 * warning colour: it is the one case where history is still in force.
 * A superseded one can name its successor, and the tag then opens it.
 */
export function StandingTag({ standing, onOpenSuccessor }: {
  standing: Standing;
  onOpenSuccessor?: (() => void) | undefined;
}): JSX.Element {
  const cls = `standing-tag standing-${standing.kind}` +
    (standing.stillAttached ? " standing-attached" : "");
  const text = standing.stillAttached ? `⚠ ${standing.label}` : standing.label;
  if (standing.kind === "superseded" && onOpenSuccessor !== undefined) {
    return (
      <button className={`ghost ${cls}`} title={standing.title}
              onClick={onOpenSuccessor}>
        {text}
      </button>
    );
  }
  return <span className={cls} title={standing.title}>{text}</span>;
}
