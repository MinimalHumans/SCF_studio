// SPDX-License-Identifier: Apache-2.0
/**
 * objectUrlCache.test.ts — the refcount, which is the part that leaks.
 *
 * Thumbnails made shared object URLs the normal case: one plate can be
 * in a bundle list, on a binding, behind a subject's anchor and in the
 * asset browser at the same moment. The failure modes are all silent —
 * a URL revoked while something is still drawing it shows a broken
 * image for a file that is present, and a URL never revoked pins a file
 * handle for the life of the session. Neither shows up in a typecheck
 * and neither is visible in a screenshot.
 *
 * No view is imported (the app rule: anything under ui/ spawns the SQL
 * worker), and the module's clock is driven with fake timers rather
 * than waited on.
 */

import { afterEach, beforeEach, describe, expect, test, vi }
  from "vitest";

const reads = vi.hoisted(() => ({ count: 0, fail: false }));

vi.mock("../src/files/assetLocator.ts", () => ({
  assetObjectUrl: async (_root: unknown, path: string) => {
    reads.count += 1;
    // A read is asynchronous, which is the whole reason the in-flight
    // cases below exist.
    await Promise.resolve();
    return reads.fail ? null : `blob:${path}#${reads.count}`;
  },
}));

const { acquire, release, revokeAll } =
  await import("../src/files/objectUrlCache.ts");

const ROOT = { name: "project" } as unknown as FileSystemDirectoryHandle;
const OTHER = { name: "project" } as unknown as FileSystemDirectoryHandle;

let revoked: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  reads.count = 0;
  reads.fail = false;
  revoked = [];
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((u: string) => {
    revoked.push(u);
  });
});

afterEach(() => {
  revokeAll();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("objectUrlCache", () => {
  test("two holders of one file share a single read", async () => {
    const a = await acquire(ROOT, "assets/x.png");
    const b = await acquire(ROOT, "assets/x.png");
    expect(a).toBe(b);
    expect(reads.count).toBe(1);
  });

  // Ten rows scrolling into view at once must not become ten reads of
  // the same plate while the first is still in flight.
  test("simultaneous acquires collapse into one read", async () => {
    const all = await Promise.all(
      Array.from({ length: 10 }, () => acquire(ROOT, "assets/x.png")));
    expect(reads.count).toBe(1);
    expect(new Set(all).size).toBe(1);
  });

  test("a URL survives while anything still holds it", async () => {
    await acquire(ROOT, "assets/x.png");
    await acquire(ROOT, "assets/x.png");
    release(ROOT, "assets/x.png");
    vi.advanceTimersByTime(60_000);
    expect(revoked).toEqual([]);
  });

  test("the last release revokes, but only after the grace period",
       async () => {
    const url = await acquire(ROOT, "assets/x.png");
    release(ROOT, "assets/x.png");
    // The grace period exists because React unmounts and remounts a row
    // constantly; revoking between the two shows a broken image.
    vi.advanceTimersByTime(1000);
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(10_000);
    expect(revoked).toEqual([url]);
  });

  test("a remount inside the grace period keeps the same URL and does "
       + "not re-read", async () => {
    const first = await acquire(ROOT, "assets/x.png");
    release(ROOT, "assets/x.png");
    vi.advanceTimersByTime(1000);
    const second = await acquire(ROOT, "assets/x.png");
    expect(second).toBe(first);
    expect(reads.count).toBe(1);
    vi.advanceTimersByTime(60_000);
    expect(revoked).toEqual([]);
  });

  // Scrolled past before the read finished: nobody is left to hand the
  // URL to, and storing it would pin a file nothing is drawing.
  test("released while in flight, the URL is revoked not stored",
       async () => {
    const pending = acquire(ROOT, "assets/x.png");
    release(ROOT, "assets/x.png");
    const got = await pending;
    expect(got).toBeNull();
    expect(revoked).toHaveLength(1);
  });

  test("the same path under two different roots is two entries",
       async () => {
    const a = await acquire(ROOT, "assets/x.png");
    const b = await acquire(OTHER, "assets/x.png");
    // Roots are handles, so the key is identity — two folders can hold
    // the same relative path, and a name would collide them.
    expect(a).not.toBe(b);
    expect(reads.count).toBe(2);
  });

  test("a file that cannot be read is not a leak", async () => {
    reads.fail = true;
    expect(await acquire(ROOT, "assets/gone.png")).toBeNull();
    release(ROOT, "assets/gone.png");
    vi.advanceTimersByTime(60_000);
    expect(revoked).toEqual([]);
  });

  // The one the mutation run exposed. Releasing one of two holders and
  // letting the clock run leaves a used timer slot behind; if that slot
  // is not cleared, the LAST release takes the early exit and schedules
  // nothing, and the URL outlives the session with nobody holding it.
  test("a partial release followed by a full one still revokes",
       async () => {
    const url = await acquire(ROOT, "assets/x.png");
    await acquire(ROOT, "assets/x.png");
    release(ROOT, "assets/x.png");
    vi.advanceTimersByTime(60_000);
    expect(revoked).toEqual([]);
    release(ROOT, "assets/x.png");
    vi.advanceTimersByTime(60_000);
    expect(revoked).toEqual([url]);
  });

  test("releasing something never acquired does nothing", () => {
    expect(() => release(ROOT, "assets/never.png")).not.toThrow();
    vi.advanceTimersByTime(60_000);
    expect(revoked).toEqual([]);
  });

  // The root changed under a live session. A URL into the previous
  // folder returns real bytes from a project the user has left, which
  // is worse than a blank thumbnail because it looks like it worked.
  test("revokeAll drops everything immediately, held or not", async () => {
    const a = await acquire(ROOT, "assets/x.png");
    const b = await acquire(ROOT, "assets/y.png");
    await acquire(ROOT, "assets/y.png");
    revokeAll();
    expect(revoked.sort()).toEqual([a, b].sort());
  });

  test("after revokeAll the next acquire reads again", async () => {
    await acquire(ROOT, "assets/x.png");
    revokeAll();
    await acquire(ROOT, "assets/x.png");
    expect(reads.count).toBe(2);
  });

  test("a pending revoke does not fire after revokeAll has cleared it",
       async () => {
    await acquire(ROOT, "assets/x.png");
    release(ROOT, "assets/x.png");
    revokeAll();
    expect(revoked).toHaveLength(1);
    vi.advanceTimersByTime(60_000);
    // Exactly once: the scheduled timer must not double-revoke a URL
    // revokeAll already dealt with.
    expect(revoked).toHaveLength(1);
  });
});
