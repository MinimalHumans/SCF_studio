// SPDX-License-Identifier: Apache-2.0
/**
 * fields.ts — reading a projected row (§12.1.2) for display.
 *
 * The helpers live in scf-core (`queryMarkdown.ts`), next to the
 * markdown that uses them, so the editor's views and the markdown show
 * the same fields in the same order.
 */

export { authoredEntries, field, nameOf, valueText }
  from "@scf-core/queryMarkdown.ts";
