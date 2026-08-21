// SPDX-License-Identifier: Apache-2.0
/**
 * Spec §1.2 — header identification.
 *
 * The reader-tolerance test is the one that matters: every file written
 * before this existed carries no stamps, including the conformance
 * fixture until it was rebuilt. A reader that required them would
 * reject the format's own history.
 */
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { initDatabase } from "../src/db.ts";
import {
  SCF_APPLICATION_ID, decodeUserVersion, encodeUserVersion, fileIdentity,
} from "../src/fileIdentity.ts";
import { openNodeDatabase, type NodeDatabase } from "../src/node.ts";
import { registry } from "./setup.ts";

let fresh: NodeDatabase;

beforeAll(async () => {
  fresh = openNodeDatabase(":memory:");
  await initDatabase(fresh.exec, registry);
});

afterAll(() => { fresh.close(); });

describe("the application id", () => {
  test("is SCF1 in big-endian ASCII", () => {
    expect(SCF_APPLICATION_ID).toBe(0x53434631);
    expect(SCF_APPLICATION_ID).toBe(1396917809);
    expect(Buffer.from(
      SCF_APPLICATION_ID.toString(16), "hex").toString("ascii"))
      .toBe("SCF1");
  });

  test("does not collide with a registered id", () => {
    // sqlite/magic.txt as of 2026-08. Fossil x3, Bentley x2, Monotone
    // (offset 60), GeoPackage x2, Esri, MBTiles, TeXnicard.
    const registered = [
      0x0f055111, 0x0f055112, 0x0f055113, 0x42654462, 0x42654c6e,
      0x5f4d544e, 0x47504b47, 0x47503130, 0x45737269, 0x4d504258,
      0x6a035744,
    ];
    expect(registered).not.toContain(SCF_APPLICATION_ID);
  });
});

describe("user_version encodes the schema version", () => {
  test("major * 1000 + minor", () => {
    expect(encodeUserVersion("2.9")).toBe(2009);
    expect(encodeUserVersion("2.10")).toBe(2010);
    expect(encodeUserVersion("3.0")).toBe(3000);
  });

  test("round-trips", () => {
    for (const v of ["1.0", "2.9", "2.10", "12.345"]) {
      expect(decodeUserVersion(encodeUserVersion(v))).toBe(v);
    }
  });

  test("zero decodes to null, not to version 0.0", () => {
    // An unstamped file reads 0. Saying "0.0" would be a claim about
    // the file that the file never made.
    expect(decodeUserVersion(0)).toBeNull();
  });
});

describe("initDatabase stamps the header", () => {
  test("a fresh database identifies as SCF", async () => {
    const id = await fileIdentity(fresh.exec);
    expect(id.isScf).toBe(true);
    expect(id.applicationId).toBe(SCF_APPLICATION_ID);
    expect(id.headerSchemaVersion).toBe(registry.schemaVersion);
  });

  test("the header agrees with _scf_meta", async () => {
    const rows = await fresh.exec(
      "SELECT value FROM _scf_meta WHERE key = 'schema_version'");
    const id = await fileIdentity(fresh.exec);
    expect(id.headerSchemaVersion).toBe(String(rows[0]?.["value"]));
  });
});

describe("readers must not require the stamps (§1.2)", () => {
  test("an unstamped SQLite file reports rather than throws", async () => {
    const plain = openNodeDatabase(":memory:");
    await plain.exec("CREATE TABLE t (a)");
    const id = await fileIdentity(plain.exec);
    expect(id.isScf).toBe(false);
    expect(id.applicationId).toBe(0);
    expect(id.headerSchemaVersion).toBeNull();
    plain.close();
  });

  test("initDatabase stamps a file that predates the stamps", async () => {
    // The migration path: an existing .scf opened for writing picks the
    // stamps up, without anything being converted.
    const legacy = openNodeDatabase(":memory:");
    await legacy.exec("CREATE TABLE scene (id INTEGER PRIMARY KEY)");
    expect((await fileIdentity(legacy.exec)).isScf).toBe(false);
    await initDatabase(legacy.exec, registry);
    expect((await fileIdentity(legacy.exec)).isScf).toBe(true);
    legacy.close();
  });
});
