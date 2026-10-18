// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadRegistry, type RegistryJson } from "../src/registry.ts";
import { createSession, type SessionDriver } from "../src/session.ts";

const REGISTRY = fileURLToPath(new URL(
  "../registry/registry.json", import.meta.url));

async function fixture(over: Partial<SessionDriver> = {}) {
  const registry = loadRegistry(JSON.parse(
    await readFile(REGISTRY, "utf8")) as RegistryJson);
  const driver: SessionDriver = {
    exec: () => Promise.resolve([]),
    persist: vi.fn(() => Promise.resolve(true)),
    close: vi.fn(() => Promise.resolve()),
    ...over,
  };
  return { registry, driver, session: createSession(registry, driver) };
}

describe("revision and dirtiness", () => {
  test("a fresh session is clean", async () => {
    const { session } = await fixture();
    expect(session.dirty).toBe(false);
    expect(session.revision).toBe(session.savedRevision);
  });

  test("a write makes it dirty and persist makes it clean", async () => {
    const { session } = await fixture();
    await session.write(() => Promise.resolve());
    expect(session.dirty).toBe(true);
    expect(await session.persist()).toBe(true);
    expect(session.dirty).toBe(false);
  });

  test("a declined persist leaves it dirty", async () => {
    const { session } = await fixture({
      persist: () => Promise.resolve(false),
    });
    session.noteWrite();
    expect(await session.persist()).toBe(false);
    expect(session.dirty).toBe(true);
  });

  test("an edit that lands mid-save stays unsaved", async () => {
    let release!: () => void;
    const { session } = await fixture({
      persist: () => new Promise<boolean>((r) => {
        release = () => { r(true); };
      }),
    });
    session.noteWrite();
    const saving = session.persist();
    session.noteWrite(); // arrives while the bytes are being written
    release();
    await saving;
    expect(session.dirty).toBe(true);
  });

  test("a write that throws still counts as a write", async () => {
    const { session } = await fixture();
    await expect(session.write(() => Promise.reject(new Error("boom"))))
      .rejects.toThrow("boom");
    expect(session.dirty).toBe(true);
  });

  test("reset marks everything saved and tells subscribers", async () => {
    const { session } = await fixture();
    const seen: Array<[number, number]> = [];
    session.subscribe((s) => { seen.push([s.revision, s.savedRevision]); });
    session.noteWrite();
    session.reset();
    expect(session.dirty).toBe(false);
    expect(seen).toHaveLength(2);
    expect(seen[1]![0]).toBe(seen[1]![1]);
  });

  test("unsubscribe stops notifications", async () => {
    const { session } = await fixture();
    const listener = vi.fn();
    const off = session.subscribe(listener);
    off();
    session.noteWrite();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("writes", () => {
  test("run one at a time, in order", async () => {
    const { session } = await fixture();
    const log: string[] = [];
    const slow = session.write(async () => {
      log.push("a:start");
      await new Promise((r) => setTimeout(r, 20));
      log.push("a:end");
    });
    const fast = session.write(() => {
      log.push("b");
      return Promise.resolve();
    });
    await Promise.all([slow, fast]);
    expect(log).toEqual(["a:start", "a:end", "b"]);
  });

  test("a failed write does not block the next", async () => {
    const { session } = await fixture();
    await session.write(() => Promise.reject(new Error("x"))).catch(
      () => undefined);
    await expect(session.write(() => Promise.resolve(7))).resolves.toBe(7);
  });

  test("a read-only session refuses to write or persist", async () => {
    const { registry, driver } = await fixture();
    const ro = createSession(registry, driver, { readOnly: true });
    await expect(ro.write(() => Promise.resolve())).rejects.toThrow(
      /read-only/);
    await expect(ro.persist()).rejects.toThrow(/read-only/);
    expect(driver.persist).not.toHaveBeenCalled();
  });

  test("two persists in flight are one save", async () => {
    const { session, driver } = await fixture();
    session.noteWrite();
    await Promise.all([session.persist(), session.persist()]);
    expect(driver.persist).toHaveBeenCalledTimes(1);
  });

  test("persist passes the driver its options", async () => {
    const { session, driver } = await fixture();
    session.noteWrite();
    await session.persist({ saveAs: true });
    expect(driver.persist).toHaveBeenCalledWith({ saveAs: true });
  });
});

describe("external change", () => {
  test("a driver with no fingerprint never reports one", async () => {
    const { session } = await fixture();
    expect(await session.hasExternalChange()).toBe(false);
  });

  test("a change we did not make is reported; our own is not", async () => {
    let stamp = "v1";
    const { session } = await fixture({ fingerprint: () => Promise.resolve(stamp) });
    expect(await session.hasExternalChange()).toBe(false);
    stamp = "v2"; // someone else
    expect(await session.hasExternalChange()).toBe(true);
    // our own write re-takes the fingerprint
    await session.write(() => { stamp = "v3"; return Promise.resolve(); });
    expect(await session.hasExternalChange()).toBe(false);
  });

  test("close waits for queued writes, then closes the driver", async () => {
    const { session, driver } = await fixture();
    let done = false;
    void session.write(async () => {
      await new Promise((r) => setTimeout(r, 10));
      done = true;
    });
    await session.close();
    expect(done).toBe(true);
    expect(driver.close).toHaveBeenCalled();
  });
});
