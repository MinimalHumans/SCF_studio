// SPDX-License-Identifier: Apache-2.0
/**
 * session.ts — one open `.scf`, however it is stored.
 *
 * A session is the unit the write ops run against: a connection
 * (`SqlExec`), the registry, and the bookkeeping every writer needs
 * and used to reimplement — what has changed since the last save, how
 * to save, and whether the file moved under us.
 *
 * It is driver-agnostic on purpose. The browser app's driver edits an
 * OPFS working copy and saves by exporting bytes through the File
 * System Access API; the Node driver (`./node`) edits the file itself
 * and every commit is already durable. Both hand the ops the same
 * `ScfContext`, so a write behaves the same wherever it runs.
 *
 * REVISION
 * `revision` counts writes this session has made; `savedRevision` is the
 * revision the stored file represents. They differ exactly when there is
 * something to lose. `persist()` takes the watermark BEFORE it exports,
 * never after: an edit that lands mid-save must stay unsaved.
 *
 * WRITES
 * `write()` is the door for mutations. Writes run one at a time, so two
 * callers cannot interleave multi-step changes, and each bumps the
 * revision. Reads use `exec` directly and never wait. Do not call
 * `write()` from inside a `write()` callback: it queues behind itself.
 */

import type { SqlExec } from "./db.ts";
import type { Registry } from "./registry.ts";
import type { ScfContext } from "./resolution.ts";

/** What a storage backend supplies. */
export interface SessionDriver {
  exec: SqlExec;
  /**
   * Make the current state durable. Returns false when the user (or the
   * backend) declined — a cancelled Save As — so the session does not
   * claim to be saved. `options` is the driver's own business.
   */
  persist(options?: unknown): Promise<boolean>;
  close(): Promise<void>;
  /**
   * A cheap token that changes when the stored file changes. Optional:
   * a backend with no outside world to disagree with (a private OPFS
   * copy) has nothing to report.
   */
  fingerprint?(): Promise<string>;
}

export interface SessionState {
  revision: number;
  savedRevision: number;
}

export interface Session {
  readonly ctx: ScfContext;
  readonly exec: SqlExec;
  readonly registry: Registry;
  readonly readOnly: boolean;
  readonly revision: number;
  readonly savedRevision: number;
  /** Writes since the last successful persist. */
  readonly dirty: boolean;

  /**
   * Run a mutation. Serialised; bumps the revision when it settles.
   * With `expectedRevision`, a session that has moved on refuses with
   * `StaleRevisionError` before running `fn`, and the refusal is not a
   * write: the revision does not change.
   */
  write<T>(fn: (ctx: ScfContext) => Promise<T>,
           options?: WriteOptions): Promise<T>;
  /**
   * Record a write made outside `write()` — the app's views call ops
   * directly. Bumps the revision.
   */
  noteWrite(): void;
  /**
   * The database was replaced wholesale (opened, created, imported).
   * Nothing in it is unsaved, and every derived view must re-read.
   */
  reset(): void;

  persist(options?: unknown): Promise<boolean>;
  /**
   * True when the stored file changed since this session last opened or
   * saved it, by someone else. False when the driver cannot tell.
   */
  hasExternalChange(): Promise<boolean>;
  subscribe(listener: (state: SessionState) => void): () => void;
  close(): Promise<void>;
}

export interface WriteOptions {
  expectedRevision?: number;
  /**
   * False for a write that is rolled back by design (a dry run): it
   * changes nothing, so it must not move the revision, which would
   * invalidate the very plan it was checking.
   */
  counts?: boolean;
}

/** The caller's view of the file is out of date. */
export class StaleRevisionError extends Error {
  readonly expected: number;
  readonly actual: number;
  constructor(expected: number, actual: number) {
    super(`the file changed since revision ${expected} ` +
          `(now ${actual}); read it again before writing`);
    this.name = "StaleRevisionError";
    this.expected = expected;
    this.actual = actual;
  }
}

export interface SessionOptions {
  readOnly?: boolean;
}

export function createSession(
    registry: Registry, driver: SessionDriver,
    options: SessionOptions = {}): Session {
  const readOnly = options.readOnly ?? false;
  const ctx: ScfContext = { exec: driver.exec, registry };
  const listeners = new Set<(state: SessionState) => void>();
  let revision = 0;
  let savedRevision = 0;
  let queue: Promise<unknown> = Promise.resolve();
  let persisting: Promise<boolean> | null = null;
  let known: string | undefined;
  let fingerprinted: Promise<void> = Promise.resolve();

  const notify = (): void => {
    const state = { revision, savedRevision };
    for (const listener of listeners) listener(state);
  };
  // Our own writes move the fingerprint, so it is re-taken after each of
  // them; only a change we did not make is "external". A file that cannot
  // be read at all is a change too.
  const refreshFingerprint = (): Promise<void> => {
    fingerprinted = (async () => {
      if (driver.fingerprint === undefined) return;
      try {
        known = await driver.fingerprint();
      } catch {
        known = "unreadable";
      }
    })();
    return fingerprinted;
  };
  const refused = (): Error =>
    new Error("this session is read-only; open it for writing first");

  const session: Session = {
    ctx, exec: driver.exec, registry, readOnly,
    get revision() { return revision; },
    get savedRevision() { return savedRevision; },
    get dirty() { return revision !== savedRevision; },

    write<T>(fn: (c: ScfContext) => Promise<T>,
             writeOptions: WriteOptions = {}): Promise<T> {
      if (readOnly) return Promise.reject(refused());
      const run = queue.then(async () => {
        // Checked here, in the queue, so it compares against the
        // revision this write would really start from.
        const expected = writeOptions.expectedRevision;
        if (expected !== undefined && expected !== revision) {
          throw new StaleRevisionError(expected, revision);
        }
        const counts = writeOptions.counts !== false;
        try {
          return await fn(ctx);
        } finally {
          // Even a write that threw may have changed rows, so it counts.
          if (counts) {
            revision += 1;
            notify();
            await refreshFingerprint();
          }
        }
      });
      queue = run.catch(() => undefined);
      return run;
    },

    noteWrite() {
      revision += 1;
      notify();
    },

    reset() {
      revision += 1;
      savedRevision = revision;
      notify();
      void refreshFingerprint();
    },

    persist(persistOptions?: unknown): Promise<boolean> {
      if (readOnly) return Promise.reject(refused());
      // A second click while one is in flight is the same save.
      if (persisting !== null) return persisting;
      const at = revision;
      persisting = (async () => {
        try {
          const done = await driver.persist(persistOptions);
          if (done) {
            savedRevision = at;
            await refreshFingerprint();
            notify();
          }
          return done;
        } finally {
          persisting = null;
        }
      })();
      return persisting;
    },

    async hasExternalChange() {
      await fingerprinted;
      if (driver.fingerprint === undefined || known === undefined) {
        return false;
      }
      try {
        return (await driver.fingerprint()) !== known;
      } catch {
        return known !== "unreadable";
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    async close() {
      await queue;
      await driver.close();
    },
  };
  void refreshFingerprint();
  return session;
}
