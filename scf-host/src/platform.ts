// SPDX-License-Identifier: Apache-2.0
/**
 * platform.ts — what the host needs from the machine it runs on.
 *
 * The host core (`core.ts`) is the same wherever it runs: in a Node
 * process (`hostCore.ts`, which supplies `nodePlatform.ts`), or in the
 * desktop app's window, where the shell supplies files and SQLite. All
 * it asks of either is here: open a `.scf`, a handful of file
 * operations, path spelling, and a hash. Nothing in this module or in
 * `core.ts` imports Node, so the window can bundle both.
 *
 * File operations are async because the window's go through the shell.
 * Path spelling is sync and pure (`paths.ts` has one for each OS).
 */

import type { Registry, Session, SqlExec } from "@minimalhumans/scf-core";

/** A connection to a `.scf` that is not a session: the host's reader. */
export interface PlatformDatabase {
  exec: SqlExec;
  close(): Promise<void>;
}

export interface PlatformDirEntry {
  name: string;
  kind: "dir" | "file" | "other";
  size: number;
  /** ISO 8601. */
  modified: string;
}

/** How paths are spelled on this machine. */
export interface PathOps {
  join(...parts: string[]): string;
  dirname(path: string): string;
  basename(path: string): string;
  /** Is `path` `root` or below it? Both are already `real`. */
  within(root: string, path: string): boolean;
  /**
   * `path` as given by someone working in `base` (absolute): made
   * absolute against it, `.` and `..` gone, as `node:path` `resolve`.
   * No links are followed; that is `real`.
   */
  resolve(base: string, path: string): string;
}

export interface HostPlatform {
  readonly paths: PathOps;

  /**
   * The one spelling of `path`: absolute, links resolved. A path that
   * does not exist yet is its nearest existing ancestor's spelling plus
   * the rest, so a link cannot smuggle a new file out of the roots.
   */
  real(path: string): Promise<string>;

  /** A write session on the file itself: every commit is durable. */
  openSession(path: string, registry: Registry): Promise<Session>;
  /** A read-only connection beside it. */
  openReader(path: string): Promise<PlatformDatabase>;

  exists(path: string): Promise<boolean>;
  /** A folder's entries, any that cannot be read left out. */
  readDir(path: string): Promise<PlatformDirEntry[]>;
  readText(path: string): Promise<string>;
  /** Append, making the folder if need be. */
  appendText(path: string, text: string): Promise<void>;
  /** A new file holding `bytes`; refuses if it exists. */
  createFile(path: string, bytes: Uint8Array): Promise<void>;
  mkdir(path: string): Promise<void>;
  /** Gone, if it was there. */
  remove(path: string): Promise<void>;

  /** Hex SHA-1 of `text`, for naming a film's files. */
  sha1(text: string): Promise<string>;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
