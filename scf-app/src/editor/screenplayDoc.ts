// SPDX-License-Identifier: Apache-2.0
/**
 * editor/screenplayDoc.ts — editor state → commit plan.
 *
 * The one piece of the document model that needs an EditorState. The
 * block model, Fountain export and the commit projection itself are in
 * scf-core (screenplay/blocks.ts); this reads the lines out of the
 * editor and hands them over.
 */

import type { EditorState } from "@codemirror/state";
import {
  planCommit, type Block, type CommitPlan,
} from "@scf-core/screenplay/blocks.ts";
import { lineEntries } from "./lineState.ts";

export function commitPlan(
    state: EditorState,
    previous: Map<string, Block>): CommitPlan {
  const entries = lineEntries(state);
  const lines = [];
  for (let i = 0; i < state.doc.lines; i++) {
    const entry = entries[i];
    if (entry === undefined) break;
    lines.push({ entry, text: state.doc.line(i + 1).text });
  }
  return planCommit(lines, previous);
}
