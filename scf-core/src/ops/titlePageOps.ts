// SPDX-License-Identifier: Apache-2.0
/**
 * ops/titlePageOps.ts — writing one key of the screenplay title page.
 */

import { withTransaction, type Row, type SqlExec } from "../db.ts";

export interface TitleKeyDef {
  key: string;
  /** Other spellings a file may carry for the same slot. */
  aliases?: string[];
}

/** Fountain's title-page keys, in the order a title page reads. */
export const TITLE_KEYS: readonly TitleKeyDef[] = [
  { key: "Title" },
  { key: "Credit" },
  { key: "Author", aliases: ["Authors"] },
  { key: "Source" },
  { key: "Draft date" },
  { key: "Contact" },
  { key: "Copyright" },
  { key: "Notes" },
];

const same = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

const names = (k: TitleKeyDef): string[] => [k.key, ...(k.aliases ?? [])];

/** The stored row that holds `k`, under any of its spellings. */
export function titleSlot(rows: readonly Row[],
                          k: TitleKeyDef): Row | undefined {
  return rows.find((r) => names(k).some((n) => same(String(r["key"]), n)));
}

/**
 * Write one title-page key. An emptied key is removed rather than kept
 * blank: an exported `Draft date:` with nothing after it is a line on the
 * page that says nothing. A key not in `TITLE_KEYS` goes at the end.
 */
export async function setTitleKey(
    exec: SqlExec, keyName: string, value: string): Promise<void> {
  const k = TITLE_KEYS.find((t) => names(t).some((n) => same(n, keyName)))
    ?? { key: keyName };
  await withTransaction(exec, async () => {
    const rows = await exec(
      "SELECT id, key, sort_order FROM screenplay_title_page");
    const existing = titleSlot(rows, k);
    if (value.trim() === "") {
      if (existing !== undefined) {
        await exec("DELETE FROM screenplay_title_page WHERE id = ?",
                   [Number(existing["id"])]);
      }
      return;
    }
    if (existing !== undefined) {
      await exec("UPDATE screenplay_title_page SET value = ? WHERE id = ?",
                 [value, Number(existing["id"])]);
      return;
    }
    // In its place in the standard order, not at the end: a Source added
    // later belongs under the author, not after the contact block. It
    // goes after the last row of a key that comes before it; the rows
    // after that move down one.
    const rank = (key: string): number => TITLE_KEYS.findIndex((t) =>
      names(t).some((n) => same(n, key)));
    const mine = TITLE_KEYS.findIndex((t) => t.key === k.key);
    const sorted = [...rows].sort((a, b) =>
      Number(a["sort_order"] ?? 0) - Number(b["sort_order"] ?? 0));
    const before = sorted.filter((r) => {
      const at = rank(String(r["key"]));
      return at >= 0 && at < mine;
    }).at(-1);
    const at = before === undefined
      ? (mine < 0 ? Math.max(-1, ...sorted.map((r) =>
          Number(r["sort_order"] ?? 0))) + 1 : 0)
      : Number(before["sort_order"] ?? 0) + 1;
    await exec("UPDATE screenplay_title_page SET sort_order = sort_order + 1 " +
               "WHERE sort_order >= ?", [at]);
    // Fountain keys are case-blind, but a page that says `title:` and
    // then `Copyright:` reads as two hands. Follow the file's own habit.
    const lower = rows.length > 0 && rows.every((r) => {
      const key = String(r["key"]);
      return key === key.toLowerCase();
    });
    await exec(
      "INSERT INTO screenplay_title_page (key, value, sort_order) " +
      "VALUES (?, ?, ?)", [lower ? k.key.toLowerCase() : k.key, value, at]);
  });
}
