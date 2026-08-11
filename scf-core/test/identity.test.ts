/**
 * identity.test.ts — the uuid inspector's answers, pinned.
 *
 * Two subjects. The checked-in fixture is the conformance target: it
 * must audit clean, and every uuid in it must be findable. A scratch
 * database is then damaged on purpose, because the whole point of the
 * inspector is what it says when something IS wrong, and a suite that
 * only ever sees healthy data proves nothing about that.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { initDatabase, newUuid } from "../src/db.ts";
import {
  auditIdentity, browseUuids, findByUuid, isUuidShaped, rowIdentity,
} from "../src/identity.ts";
import { openNodeDatabase, type NodeDatabase } from "../src/node.ts";
import { FIXTURE_PATH, registry } from "./setup.ts";

let fixture: NodeDatabase;

beforeAll(() => {
  fixture = openNodeDatabase(FIXTURE_PATH, { readOnly: true });
});

afterAll(() => {
  fixture.close();
});

describe("isUuidShaped", () => {
  test("accepts canonical form in either case", () => {
    expect(isUuidShaped("3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(true);
    expect(isUuidShaped("3F2504E0-4F89-41D3-9A0C-0305E82C3301")).toBe(true);
  });

  test("rejects everything else", () => {
    expect(isUuidShaped("")).toBe(false);
    expect(isUuidShaped("not-a-uuid")).toBe(false);
    expect(isUuidShaped("3f2504e04f8941d39a0c0305e82c3301")).toBe(false);
    expect(isUuidShaped(null)).toBe(false);
    expect(isUuidShaped(42)).toBe(false);
  });
});

describe("auditIdentity on the fixture", () => {
  test("the conformance fixture has clean identity", async () => {
    const audit = await auditIdentity(fixture.exec, registry);
    const summary = audit.findings
      .map((f) => `${f.kind} ${f.table} (${f.count})`).join("; ");
    expect(summary).toBe("");
    expect(audit.clean).toBe(true);
  });

  test("every populated registry table carries uuids on every row",
    async () => {
      const audit = await auditIdentity(fixture.exec, registry);
      for (const t of audit.tables) {
        if (!t.present || t.rows === 0) continue;
        expect(t.hasUuidColumn, `${t.table} uuid column`).toBe(true);
        expect(t.missingUuid, `${t.table} missing uuids`).toBe(0);
        expect(t.malformed, `${t.table} malformed uuids`).toBe(0);
      }
    });

  test("totals agree with the per-table rows", async () => {
    const audit = await auditIdentity(fixture.exec, registry);
    const rows = audit.tables.reduce((n, t) => n + t.rows, 0);
    expect(audit.totals.rows).toBe(rows);
    expect(audit.totals.withUuid).toBe(rows);
    expect(audit.totals.rows).toBeGreaterThan(0);
  });
});

describe("findByUuid on the fixture", () => {
  test("finds a known row by its uuid, and only that row", async () => {
    const [row] = await fixture.exec(
      "SELECT id, uuid, name FROM character ORDER BY id LIMIT 1");
    expect(row).toBeDefined();
    const hits = await findByUuid(
      fixture.exec, registry, String(row?.["uuid"]));
    expect(hits).toHaveLength(1);
    expect(hits[0]?.table).toBe("character");
    expect(hits[0]?.id).toBe(Number(row?.["id"]));
    expect(hits[0]?.label).toBe(String(row?.["name"]));
  });

  test("finds junction rows too — uuid is on all 99 entities", async () => {
    const [row] = await fixture.exec(
      "SELECT uuid FROM scene_character WHERE uuid IS NOT NULL LIMIT 1");
    if (row === undefined) return; // fixture without the junction populated
    const hits = await findByUuid(
      fixture.exec, registry, String(row["uuid"]));
    expect(hits).toHaveLength(1);
    expect(hits[0]?.table).toBe("scene_character");
  });

  test("an unknown uuid returns nothing rather than throwing", async () => {
    expect(await findByUuid(fixture.exec, registry, newUuid())).toEqual([]);
  });

  test("whitespace is tolerated, empty input is not a search", async () => {
    const [row] = await fixture.exec(
      "SELECT uuid FROM scene ORDER BY id LIMIT 1");
    const padded = `  ${String(row?.["uuid"])}\n`;
    expect(await findByUuid(fixture.exec, registry, padded))
      .toHaveLength(1);
    expect(await findByUuid(fixture.exec, registry, "   ")).toEqual([]);
  });
});

describe("rowIdentity on the fixture", () => {
  test("reports a row's uuid and lifecycle", async () => {
    const [row] = await fixture.exec(
      "SELECT id FROM character ORDER BY id LIMIT 1");
    const ident = await rowIdentity(
      fixture.exec, registry, "character", Number(row?.["id"]));
    expect(ident.exists).toBe(true);
    expect(ident.uuidWellFormed).toBe(true);
    expect(ident.findings).toEqual([]);
  });

  test("a missing row is reported, not thrown", async () => {
    const ident = await rowIdentity(
      fixture.exec, registry, "character", 999999);
    expect(ident.exists).toBe(false);
    expect(ident.chain).toEqual([]);
  });

  test("a link entity exposes its natural key", async () => {
    const [row] = await fixture.exec(
      "SELECT id FROM scene_character ORDER BY id LIMIT 1");
    if (row === undefined) return;
    const ident = await rowIdentity(
      fixture.exec, registry, "scene_character", Number(row["id"]));
    expect(ident.naturalKey).not.toBeNull();
    const fields = (ident.naturalKey ?? []).map((p) => p.field);
    expect(fields).toContain("scene_id");
    expect(fields).toContain("character_id");
  });

  test("a non-link entity has no natural key", async () => {
    const [row] = await fixture.exec(
      "SELECT id FROM character ORDER BY id LIMIT 1");
    const ident = await rowIdentity(
      fixture.exec, registry, "character", Number(row?.["id"]));
    expect(ident.naturalKey).toBeNull();
  });
});

describe("what the inspector says when identity is broken", () => {
  let db: NodeDatabase;

  beforeAll(async () => {
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry, { editorVersion: "identity-test" });
  });

  afterAll(() => db.close());

  test("a row inserted without a uuid is reported", async () => {
    await db.exec("INSERT INTO location (id, name) VALUES (9001, 'Nowhere')");
    const audit = await auditIdentity(db.exec, registry);
    const finding = audit.findings.find(
      (f) => f.kind === "missing-uuid" && f.table === "location");
    expect(finding?.count).toBe(1);
    expect(audit.clean).toBe(false);

    const ident = await rowIdentity(db.exec, registry, "location", 9001);
    expect(ident.uuid).toBeNull();
    expect(ident.findings.map((f) => f.kind)).toContain("missing-uuid");
    await db.exec("DELETE FROM location WHERE id = 9001");
  });

  test("a malformed uuid is distinguished from a missing one", async () => {
    await db.exec(
      "INSERT INTO location (id, name, uuid) VALUES (9002, 'Bad', 'nope')");
    const audit = await auditIdentity(db.exec, registry);
    expect(audit.findings.some(
      (f) => f.kind === "malformed-uuid" && f.table === "location")).toBe(true);
    expect(audit.findings.some(
      (f) => f.kind === "missing-uuid" && f.table === "location")).toBe(false);
    await db.exec("DELETE FROM location WHERE id = 9002");
  });

  // Only five entities are versionable — bundle, asset, and the three
  // shot overrides — so the chain tests use `asset`, which is also where
  // P3 will operate.
  test("a superseded row with no successor is reported", async () => {
    await db.exec(
      "INSERT INTO asset (id, name, uuid, lifecycle_status) " +
      "VALUES (9101, 'Ghost', ?, 'superseded')", [newUuid()]);
    const ident = await rowIdentity(db.exec, registry, "asset", 9101);
    expect(ident.findings.map((f) => f.kind))
      .toContain("superseded-without-successor");
    await db.exec("DELETE FROM asset WHERE id = 9101");
  });

  test("a version chain is walked root-first with the row marked",
    async () => {
      await db.exec(
        "INSERT INTO asset (id, name, uuid, version_label) " +
        "VALUES (9201, 'Draft', ?, 'v1')", [newUuid()]);
      await db.exec(
        "INSERT INTO asset (id, name, uuid, version_label, parent_id) " +
        "VALUES (9202, 'Draft', ?, 'v2', 9201)", [newUuid()]);
      await db.exec(
        "INSERT INTO asset (id, name, uuid, version_label, parent_id) " +
        "VALUES (9203, 'Draft', ?, 'v3', 9202)", [newUuid()]);

      const ident = await rowIdentity(db.exec, registry, "asset", 9202);
      expect(ident.chain.map((l) => l.id)).toEqual([9201, 9202]);
      expect(ident.position).toBe(1);
      expect(ident.chain[1]?.self).toBe(true);
      expect(ident.chain[0]?.versionLabel).toBe("v1");
    });

  test("a fork is reported at the row that forks", async () => {
    await db.exec(
      "INSERT INTO asset (id, name, uuid, parent_id) " +
      "VALUES (9204, 'Branch', ?, 9202)", [newUuid()]);
    const ident = await rowIdentity(db.exec, registry, "asset", 9202);
    const fork = ident.findings.find((f) => f.kind === "chain-fork");
    expect(fork?.count).toBe(2);
  });

  test("a cycle terminates the walk instead of hanging", async () => {
    await db.exec(
      "INSERT INTO asset (id, name, uuid, parent_id) " +
      "VALUES (9301, 'A', ?, 9302)", [newUuid()]);
    await db.exec(
      "INSERT INTO asset (id, name, uuid, parent_id) " +
      "VALUES (9302, 'B', ?, 9301)", [newUuid()]);
    const ident = await rowIdentity(db.exec, registry, "asset", 9301);
    expect(ident.findings.map((f) => f.kind)).toContain("chain-cycle");
  });

  test("supersession that disagrees with parentage is reported",
    async () => {
      await db.exec(
        "INSERT INTO asset (id, name, uuid) VALUES (9401, 'X', ?)",
        [newUuid()]);
      await db.exec(
        "INSERT INTO asset (id, name, uuid) VALUES (9402, 'Y', ?)",
        [newUuid()]);
      await db.exec(
        "UPDATE asset SET superseded_by_id = 9402, " +
        "superseded_at = '2026-01-01T00:00:00Z' WHERE id = 9401");
      const ident = await rowIdentity(db.exec, registry, "asset", 9401);
      expect(ident.findings.map((f) => f.kind)).toContain("chain-asymmetric");
    });

  test("an external id with no namespace is reported", async () => {
    await db.exec(
      "INSERT INTO asset (id, name, uuid, external_id) " +
      "VALUES (9501, 'Bridged', ?, 'omc:123')", [newUuid()]);
    const ident = await rowIdentity(db.exec, registry, "asset", 9501);
    expect(ident.findings.map((f) => f.kind))
      .toContain("external-id-without-namespace");
  });

  test("duplicate uuids are counted where the index allows them",
    async () => {
      // The unique index makes this impossible on a healthy file, which
      // is the point: the audit reports the index, and the count only
      // ever moves if the index is gone.
      const audit = await auditIdentity(db.exec, registry);
      const character = audit.tables.find((t) => t.table === "character");
      expect(character?.hasUniqueIndex).toBe(true);
      expect(character?.duplicated).toBe(0);
    });
});

describe("browseUuids", () => {
  test("lists rows with their uuids so one can be found at all",
    async () => {
      const page = await browseUuids(fixture.exec, registry, "character", 5);
      expect(page.rows.length).toBeGreaterThan(0);
      expect(page.total).toBeGreaterThanOrEqual(page.rows.length);
      for (const r of page.rows) expect(isUuidShaped(r.uuid)).toBe(true);
      expect(page.rows[0]?.label).not.toBeNull();
    });

  test("pages by offset", async () => {
    const first = await browseUuids(fixture.exec, registry, "scene", 2, 0);
    const second = await browseUuids(fixture.exec, registry, "scene", 2, 2);
    expect(first.rows.map((r) => r.id))
      .not.toEqual(second.rows.map((r) => r.id));
  });

  test("a uuid read from browse is findable by lookup", async () => {
    const page = await browseUuids(fixture.exec, registry, "location", 1);
    const uuid = page.rows[0]?.uuid;
    expect(uuid).not.toBeNull();
    const hits = await findByUuid(fixture.exec, registry, String(uuid));
    expect(hits[0]?.table).toBe("location");
    expect(hits[0]?.id).toBe(page.rows[0]?.id);
  });

  test("an absent table is empty, not an error", async () => {
    expect(await browseUuids(fixture.exec, registry, "no_such_table"))
      .toEqual({ rows: [], total: 0 });
  });
});
