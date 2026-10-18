// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, test } from "vitest";
import { openNodeDatabase } from "../src/node.ts";
import { initScreenplayTables } from "../src/screenplay/rowModel.ts";
import { setTitleKey } from "../src/ops/titlePageOps.ts";

describe("setTitleKey", () => {
  let db: ReturnType<typeof openNodeDatabase>;
  const page = async (): Promise<string[]> =>
    (await db.exec(
      "SELECT key, value FROM screenplay_title_page ORDER BY sort_order"))
      .map((r) => `${String(r["key"])}=${String(r["value"])}`);

  beforeEach(async () => {
    db = openNodeDatabase(":memory:");
    await initScreenplayTables(db.exec);
  });

  test("a new key lands in the standard order, not at the end", async () => {
    await setTitleKey(db.exec, "Title", "HOLLOW CREEK");
    await setTitleKey(db.exec, "Copyright", "(c) Me");
    await setTitleKey(db.exec, "Author", "J. K.");
    expect(await page()).toEqual([
      "Title=HOLLOW CREEK", "Author=J. K.", "Copyright=(c) Me",
    ]);
  });

  test("an existing key is updated in place", async () => {
    await setTitleKey(db.exec, "Title", "A");
    await setTitleKey(db.exec, "Title", "B");
    expect(await page()).toEqual(["Title=B"]);
  });

  test("an emptied key is removed", async () => {
    await setTitleKey(db.exec, "Title", "A");
    await setTitleKey(db.exec, "Credit", "Written by");
    await setTitleKey(db.exec, "Title", "   ");
    expect(await page()).toEqual(["Credit=Written by"]);
  });

  test("an alias finds the stored row", async () => {
    await db.exec(
      "INSERT INTO screenplay_title_page (key, value, sort_order) " +
      "VALUES ('Authors', 'A and B', 0)");
    await setTitleKey(db.exec, "Author", "C");
    expect(await page()).toEqual(["Authors=C"]);
  });

  test("a file written in lower case stays in lower case", async () => {
    await db.exec(
      "INSERT INTO screenplay_title_page (key, value, sort_order) " +
      "VALUES ('title', 'X', 0)");
    await setTitleKey(db.exec, "Copyright", "(c)");
    expect(await page()).toEqual(["title=X", "copyright=(c)"]);
  });

  test("a key outside the standard list goes at the end", async () => {
    await setTitleKey(db.exec, "Title", "A");
    await setTitleKey(db.exec, "Revision", "Blue");
    await setTitleKey(db.exec, "Credit", "Written by");
    expect(await page()).toEqual(
      ["Title=A", "Credit=Written by", "Revision=Blue"]);
  });
});
