// SPDX-License-Identifier: Apache-2.0
/**
 * fileIdentity.ts — the header stamps that make a `.scf` identifiable
 * without opening a table. Spec §1.2.
 *
 * SQLite reserves two 32-bit slots in the database header for exactly
 * this: `application_id` at byte offset 68, `user_version` at 60. Both
 * sit in the first 100 bytes, so `file(1)`, a content-type sniffer or a
 * quarantining mail gateway can identify a `.scf` from the first page
 * without a SQL engine — and, more usefully, can tell an SCF document
 * apart from the thousands of unrelated SQLite databases on a machine.
 *
 * READERS MUST NOT REQUIRE THEM. Every file written before schema 2.10
 * carries neither, and refusing those would break the format's own
 * corpus. The stamps are an identification aid, never a gate — which is
 * why `fileIdentity()` reports rather than validates, in keeping with
 * §9.1.
 */

import type { SqlExec } from "./db.ts";

/**
 * `SCF1` as big-endian ASCII, the convention SQLite's own magic.txt
 * registry follows (Fossil, GeoPackage, MBTiles all do the same).
 *
 * The trailing `1` is the CONTAINER generation, not the schema version
 * — it changes only if the physical encoding ever breaks compatibility,
 * which is a thing that should happen approximately never. Schema
 * version lives in `user_version`, where it can move freely.
 * GeoPackage sets the precedent for a digit here: it registered both
 * `GPKG` and `GP10`.
 */
export const SCF_APPLICATION_ID = 0x53434631; // 1396917809

/** Schema "2.9" → 2009. Keeps the header sortable and human-readable. */
export function encodeUserVersion(schemaVersion: string): number {
  const [major = "0", minor = "0"] = schemaVersion.split(".");
  return Number(major) * 1000 + Number(minor);
}

/** 2009 → "2.9". Zero means "not stamped", not "version 0.0". */
export function decodeUserVersion(userVersion: number): string | null {
  if (!Number.isFinite(userVersion) || userVersion <= 0) return null;
  return `${Math.floor(userVersion / 1000)}.${userVersion % 1000}`;
}

export interface FileIdentity {
  applicationId: number;
  userVersion: number;
  /** True when the header carries SCF's application id. */
  isScf: boolean;
  /**
   * Schema version decoded from the header, or null when unstamped.
   * This is a HINT: `_scf_meta.schema_version` is the authority, and a
   * disagreement between them is a finding, not a reason to refuse.
   */
  headerSchemaVersion: string | null;
}

/** Stamp the header. Called by initDatabase; safe to re-run. */
export async function stampFileIdentity(
    exec: SqlExec, schemaVersion: string): Promise<void> {
  // PRAGMA does not take bound parameters.
  await exec(`PRAGMA application_id = ${String(SCF_APPLICATION_ID)}`);
  await exec(
    `PRAGMA user_version = ${String(encodeUserVersion(schemaVersion))}`);
}

/** Read the header stamps. Never throws on an unstamped file. */
export async function fileIdentity(exec: SqlExec): Promise<FileIdentity> {
  const read = async (pragma: string): Promise<number> => {
    const rows = await exec(`PRAGMA ${pragma}`);
    const first = rows[0];
    if (first === undefined) return 0;
    const value = Object.values(first)[0];
    return typeof value === "number" ? value : Number(value ?? 0);
  };
  const applicationId = await read("application_id");
  const userVersion = await read("user_version");
  return {
    applicationId,
    userVersion,
    isScf: applicationId === SCF_APPLICATION_ID,
    headerSchemaVersion: decodeUserVersion(userVersion),
  };
}
