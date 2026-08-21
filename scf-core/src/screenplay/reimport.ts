// SPDX-License-Identifier: Apache-2.0
/**
 * screenplay/reimport.ts — uuid-preserving re-import (the revision flow's
 * diff step). The sacred flow: export → edit elsewhere → re-import must
 * not sever line identity, because 2.3 uuids are what cross-file
 * references and annotations hang on.
 *
 * diffScreenplay matches old rows to new rows and carries uuids across:
 *  - anchor on lines whose (type, content) key is UNIQUE in both
 *    versions, kept in order (longest increasing subsequence) — the
 *    patience-diff idea, which stays fast on multi-thousand-line scripts
 *  - between consecutive anchors, match equal lines greedily from both
 *    ends of the gap
 *  - unmatched new lines get fresh uuids at write time; unmatched old
 *    lines are reported as removed
 *
 * Moved blocks are remove+add in this version (their lines re-key) —
 * deliberate simplicity; the staging screen reports the counts so the
 * author sees what identity survived.
 */

import type { ScreenplayRow } from "./rowModel.ts";

export interface ReimportDiff {
  /** New rows with uuids carried over where lines matched. */
  rows: ScreenplayRow[];
  kept: number;
  added: number;
  removed: number;
}

const keyOf = (r: ScreenplayRow): string =>
  `${r.lineType}\u0000${r.content}`;

/** Longest increasing subsequence (by oldIndex) over anchor pairs
 * ordered by newIndex; returns the selected pairs. */
function lis(pairs: Array<[number, number]>): Array<[number, number]> {
  const tailsIdx: number[] = [];
  const prev: number[] = new Array<number>(pairs.length).fill(-1);
  const tailPair: number[] = [];
  pairs.forEach(([oldIdx], i) => {
    let lo = 0;
    let hi = tailsIdx.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((pairs[tailPair[mid]!]?.[0] ?? Infinity) < oldIdx) lo = mid + 1;
      else hi = mid;
    }
    tailsIdx[lo] = oldIdx;
    tailPair[lo] = i;
    prev[i] = lo > 0 ? tailPair[lo - 1]! : -1;
  });
  const out: Array<[number, number]> = [];
  let at = tailPair[tailsIdx.length - 1] ?? -1;
  while (at !== -1) {
    out.unshift(pairs[at]!);
    at = prev[at]!;
  }
  return out;
}

export function diffScreenplay(
    oldRows: ScreenplayRow[], newRows: ScreenplayRow[]): ReimportDiff {
  const oldByKey = new Map<string, number[]>();
  oldRows.forEach((r, i) => {
    const k = keyOf(r);
    oldByKey.set(k, [...(oldByKey.get(k) ?? []), i]);
  });
  const newByKey = new Map<string, number[]>();
  newRows.forEach((r, i) => {
    const k = keyOf(r);
    newByKey.set(k, [...(newByKey.get(k) ?? []), i]);
  });

  // Unique-in-both anchors, ordered by new index.
  const anchorPairs: Array<[number, number]> = [];
  newRows.forEach((r, newIdx) => {
    const k = keyOf(r);
    const olds = oldByKey.get(k);
    if (olds?.length === 1 && newByKey.get(k)?.length === 1) {
      anchorPairs.push([olds[0]!, newIdx]);
    }
  });
  const anchors = lis(anchorPairs);

  const matched = new Map<number, number>(); // newIdx -> oldIdx
  for (const [oldIdx, newIdx] of anchors) matched.set(newIdx, oldIdx);

  // Fill gaps between anchors (and before the first / after the last)
  // by matching equal lines greedily from both ends.
  const bounds: Array<[number, number, number, number]> = [];
  let prevOld = -1;
  let prevNew = -1;
  for (const [oldIdx, newIdx] of [...anchors,
      [oldRows.length, newRows.length] as [number, number]]) {
    bounds.push([prevOld + 1, oldIdx - 1, prevNew + 1, newIdx - 1]);
    prevOld = oldIdx;
    prevNew = newIdx;
  }
  for (const [o1, o2, n1, n2] of bounds) {
    let of_ = o1;
    let nf = n1;
    while (of_ <= o2 && nf <= n2 &&
           keyOf(oldRows[of_]!) === keyOf(newRows[nf]!)) {
      matched.set(nf, of_);
      of_ += 1;
      nf += 1;
    }
    let ob = o2;
    let nb = n2;
    while (ob >= of_ && nb >= nf &&
           keyOf(oldRows[ob]!) === keyOf(newRows[nb]!)) {
      matched.set(nb, ob);
      ob -= 1;
      nb -= 1;
    }
  }

  const usedOld = new Set(matched.values());
  const rows = newRows.map((r, i) => {
    const oldIdx = matched.get(i);
    return oldIdx !== undefined
      ? { ...r, uuid: oldRows[oldIdx]!.uuid }
      : { ...r, uuid: undefined };
  });
  return {
    rows,
    kept: matched.size,
    added: newRows.length - matched.size,
    removed: oldRows.length - usedOld.size,
  };
}
