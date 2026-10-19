// SPDX-License-Identifier: Apache-2.0
/**
 * spike.ts — can scf-core run in the window, on the shell's SQLite,
 * instead of in the Node host? (In-app host spike.)
 *
 * Runs the same work both ways from this one page and compares:
 *
 *   roundtrip  one trivial statement, many times: the cost of a hop
 *   report     validationReport on the conformance fixture, which must
 *              match fixtures/hollow_creek.report.json byte for byte
 *   import     `import.apply` of a whole screenplay into an empty film;
 *              the two resulting files must hold the same rows
 *
 * "node" is the dev server's host over its WebSocket, as the window
 * talks to it today. "core" is the same host core run here, in the
 * window, on the shell's files and SQLite (`tauriPlatform.ts`).
 * "socket" and "invoke" are scf-core with no host at all, on the shell's
 * SQLite (`src-tauri/src/sql.rs`) over its loopback socket or through
 * Tauri's `invoke`.
 *
 * Then the in-window host does what only a host does: an agent's op
 * (snapshot first, journalled), and `list`, inside its roots and not
 * outside them.
 *
 *   npx tauri dev --config src-tauri/tauri.spike.json
 *   npx tauri dev --release --features spike --config src-tauri/tauri.spike.json
 *
 * prints the result as JSON and exits.
 */

import { invoke } from "@tauri-apps/api/core";
import registryJson from "@registry/registry.json" with { type: "json" };
import type { SqlExec } from "@scf-core/db.ts";
import { initDatabase } from "@scf-core/db.ts";
import { callFn } from "@scf-core/ops/calls.ts";
import { prepareImport } from "@scf-core/ops/importPipeline.ts";
import { loadRegistry, type RegistryJson } from "@scf-core/registry.ts";
import { validationReport } from "@scf-core/report.ts";
import { createSession } from "@scf-core/session.ts";
import {
  HostClient, HostClientError, connectInProcess,
} from "@scf-host/client.ts";
import { createHostCore } from "@scf-host/core.ts";
import { connectHost } from "../host/connection.ts";
import { createTauriPlatform } from "../host/tauriPlatform.ts";
import { openTauriDatabase, openTauriSession } from "../host/tauriSql.ts";

const registry = loadRegistry(registryJson as unknown as RegistryJson);

interface Setup {
  work: string;
  reportJson: string;
  fountain: string;
}

const ROUNDTRIPS = 1000;

/** Counts the statements a piece of work issues. */
function counted(exec: SqlExec): { exec: SqlExec; n: () => number } {
  let n = 0;
  return { exec: (sql, params) => { n += 1; return exec(sql, params); },
           n: () => n };
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = performance.now();
  const out = await fn();
  return [out, Math.round(performance.now() - t0)];
}

/**
 * Every row of every table, as SQL literals (`quote()`), so 3 and 3.0
 * and '3' differ. Uuids and timestamps are made per run, so each is
 * replaced by the order it first appears in.
 */
async function dump(exec: SqlExec): Promise<string> {
  const tables = await exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' " +
    "AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const out: string[] = [];
  for (const t of tables) {
    const name = String(t["name"]);
    const cols = await exec(`SELECT name FROM pragma_table_info(?)`, [name]);
    const list = cols.map((c) =>
      `quote("${String(c["name"]).replaceAll('"', '""')}")`).join(", ");
    const rows = await exec(
      `SELECT ${list} FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`);
    out.push(`# ${name}`);
    for (const r of rows) out.push(Object.values(r).join(" | "));
  }
  const seen = new Map<string, string>();
  return out.join("\n")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
             (u) => {
               const k = u.toLowerCase();
               if (!seen.has(k)) seen.set(k, `uuid#${String(seen.size)}`);
               return seen.get(k)!;
             })
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, "<time>");
}

function firstDifference(a: string, b: string): string | null {
  if (a === b) return null;
  const la = a.split("\n");
  const lb = b.split("\n");
  for (let i = 0; i < Math.max(la.length, lb.length); i += 1) {
    if (la[i] !== lb[i]) {
      return `line ${String(i + 1)}:\n  node:  ${la[i] ?? "(end)"}\n` +
             `  tauri: ${lb[i] ?? "(end)"}`;
    }
  }
  return "same lines, different text";
}

async function roundtrips(exec: SqlExec): Promise<number> {
  const [, ms] = await timed(async () => {
    for (let i = 0; i < ROUNDTRIPS; i += 1) await exec("SELECT ?", [i]);
  });
  return ms / ROUNDTRIPS;
}

type Via = "socket" | "invoke";
const VIAS: Via[] = ["socket", "invoke"];
type Host = "node" | "core";
const HOSTS: Host[] = ["node", "core"];

async function run(): Promise<Record<string, unknown>> {
  const setup = await invoke<Setup>("spike_setup");
  const sep = setup.work.includes("\\") ? "\\" : "/";
  const at = (name: string): string => `${setup.work}${sep}${name}`;
  const copy = (from: string, to: string): Promise<void> =>
    invoke("spike_copy", { from: at(from), to: at(to) });
  const text = (r: unknown): string => `${JSON.stringify(r, null, 2)}\n`;
  const source = { source: "fixtures/hollow_creek.scf" };

  // The host core, run here on the shell's files and SQLite, with its
  // snapshots and journal in the work folder and that folder its root.
  const core = createHostCore({
    registry, platform: await createTauriPlatform(), version: "spike",
    roots: [setup.work], snapshotDir: at("snapshots"),
    journalDir: at("journal"),
  });
  const hosts: Record<Host, HostClient> = {
    node: await connectHost({ name: "spike" }),
    core: await HostClient.connect(connectInProcess(core.connect()),
                                   { name: "spike" }),
  };

  const version = async (exec: SqlExec): Promise<string> =>
    String((await exec("SELECT sqlite_version() AS v"))[0]?.["v"]);

  const sqlite: Record<string, string> = {};
  const roundtripMs: Record<string, number> = {};
  const reportMs: Record<string, number> = {};
  const reportStatements: Record<string, number> = {};
  const matchesFixture: Record<string, boolean> = {};
  let reportDifference: string | null = null;
  const importMs: Record<string, number> = {};
  const importSame: Record<string, boolean> = {};
  const importDifference: Record<string, string | null> = {};

  // ── report ───────────────────────────────────────────────────────
  await copy("fixture-tauri.scf", "fixture-core.scf");
  for (const name of HOSTS) {
    const host = hosts[name];
    await host.open(at(`fixture-${name}.scf`), { readOnly: true });
    const read = counted(host.exec);
    const [report, ms] = await timed(() =>
      validationReport(read.exec, registry, source));
    reportMs[name] = ms;
    reportStatements[name] = read.n();
    matchesFixture[name] = text(report) === setup.reportJson;
    reportDifference ??= firstDifference(setup.reportJson, text(report));
    roundtripMs[name] = await roundtrips(host.exec);
    sqlite[name] = await version(host.exec);
  }
  for (const via of VIAS) {
    const fixture = await openTauriSession(
      at("fixture-tauri.scf"), registry, { via });
    const read = counted(fixture.exec);
    const [report, ms] = await timed(() =>
      validationReport(read.exec, registry, source));
    reportMs[via] = ms;
    reportStatements[via] = read.n();
    matchesFixture[via] = text(report) === setup.reportJson;
    reportDifference ??= firstDifference(setup.reportJson, text(report));
    roundtripMs[via] = await roundtrips(fixture.exec);
    await fixture.close();
  }

  // ── import ───────────────────────────────────────────────────────
  // One empty film, made here and copied for each: all start from the
  // same bytes.
  const empty = await openTauriSession(at("empty.scf"), registry);
  await empty.write((ctx) =>
    initDatabase(ctx.exec, registry, { editorVersion: "spike" }));
  await empty.close();
  for (const side of [...HOSTS, ...VIAS]) {
    await copy("empty.scf", `import-${side}.scf`);
  }

  const prepared = prepareImport(setup.fountain, "fountain");
  const accepted = {
    raw: setup.fountain, kind: "fountain" as const,
    accepted: {
      scenes: true,
      characterNames: prepared.proposals.characters.map(
        (c): [string, string] => [c.name.toUpperCase(), c.name]),
      props: prepared.proposals.props.map(
        (p): [string, string] => [p.name.toUpperCase(), p.name]),
    },
  };

  const dumps: Record<string, string> = {};
  for (const name of HOSTS) {
    const host = hosts[name];
    await host.open(at(`import-${name}.scf`));
    [, importMs[name]] = await timed(() =>
      host.call("import.apply", [accepted]));
    dumps[name] = await dump(host.exec);
  }

  let importStatements = 0;
  for (const via of VIAS) {
    const db = await openTauriDatabase(at(`import-${via}.scf`), { via });
    const statements = counted(db.exec);
    const film = createSession(registry, {
      exec: statements.exec, persist: () => Promise.resolve(true),
      close: db.close,
    });
    [, importMs[via]] = await timed(() =>
      callFn(film, "import.apply", [accepted]));
    importStatements = statements.n();
    dumps[via] = await dump(db.exec);
    await film.close();
  }
  for (const side of ["core", ...VIAS]) {
    importSame[side] = dumps["node"] === dumps[side];
    importDifference[side] = firstDifference(dumps["node"]!, dumps[side]!);
  }

  // ── the host core's own work, here ───────────────────────────────
  // An agent's op takes a snapshot first and is journalled; `list`
  // stays inside the roots.
  const agent = await HostClient.connect(connectInProcess(core.connect()),
                                         { name: "mcp: spike" });
  await agent.open(at("import-core.scf"));
  const added = await agent.op("record.create",
    { entity: "character", values: { name: "Spike" } });
  const heard = await hosts.core.journal();
  const listed = await hosts.core.list(setup.work);
  let outside: string | null = null;
  try {
    await hosts.core.list(at(".."));
  } catch (e) {
    outside = e instanceof HostClientError ? e.code : String(e);
  }
  const coreHost = {
    snapshotTaken: added.snapshot !== undefined &&
      await invoke<boolean>("fs_exists", { path: added.snapshot }),
    revision: added.revision,
    journal: heard.map((e) => `${e.by} ${e.via} ${e.name} ${String(e.ok)}`),
    listed: listed.entries.map((e) => `${e.kind} ${e.name}`),
    outsideRoots: outside,
  };

  await agent.dispose();
  for (const host of Object.values(hosts)) await host.dispose();
  await core.shutdown();

  return {
    sqlite,
    roundtripMs,
    report: {
      statements: reportStatements, ms: reportMs, matchesFixture,
      difference: reportDifference,
    },
    import: {
      script: "corpus/public/scripts/alexis-nexus.fountain",
      lines: setup.fountain.split("\n").length,
      statements: importStatements,
      rows: dumps["node"]!.split("\n")
        .filter((l) => !l.startsWith("#")).length,
      ms: importMs,
      sameAsNode: importSame,
      difference: importDifference,
    },
    coreHost,
  };
}

const out = document.getElementById("out")!;
run().then(
  (result) => JSON.stringify(result, null, 2),
  (e: unknown) => `spike failed: ${
    e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e)}`,
).then(async (text) => {
  out.textContent = text;
  await invoke("spike_report", { text });
});
