// SPDX-License-Identifier: Apache-2.0
/**
 * The conformance fixture exists twice: `fixtures/hollow_creek.scf` is
 * what the suites open, `scf-app/public/hollow_creek.scf` is what the
 * app fetches for the demo. `fixtures/build/README.md` has always said
 * the two must stay identical, and nothing checked it — so they drifted,
 * and the demo shipped a build stamped two schema versions behind the
 * one every conformance assertion was written against.
 *
 * A demo running a different fixture from the tests is a fixture that
 * proves nothing about the demo.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const digest = (url: string): string =>
  createHash("sha256")
    .update(readFileSync(fileURLToPath(new URL(url, import.meta.url))))
    .digest("hex");

describe("the demo fixture is the conformance fixture", () => {
  test("byte-identical, not merely similar", () => {
    expect(digest("../public/hollow_creek.scf"))
      .toBe(digest("../../fixtures/hollow_creek.scf"));
  });
});
