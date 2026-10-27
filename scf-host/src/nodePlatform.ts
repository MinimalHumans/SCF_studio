// SPDX-License-Identifier: Apache-2.0
/**
 * nodePlatform.ts — the host's platform (platform.ts) in a Node process:
 * `node:sqlite` through scf-core's Node driver, and `node:fs`.
 */

import {
  appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync,
  readFileSync, readSync, realpathSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import {
  basename, dirname, isAbsolute, join, relative, resolve,
} from "node:path";
import {
  openNodeDatabase, openNodeSession,
} from "@minimalhumans/scf-core/node";
import type { HostPlatform, PlatformDirEntry } from "./platform.ts";

/** `path` with links resolved, judged by its nearest existing parent. */
export function realPath(path: string): string {
  let probe = resolve(path);
  const tail: string[] = [];
  while (!existsSync(probe) && dirname(probe) !== probe) {
    tail.unshift(basename(probe));
    probe = dirname(probe);
  }
  try {
    return join(realpathSync(probe), ...tail);
  } catch {
    return resolve(path);
  }
}

export const nodePlatform: HostPlatform = {
  paths: {
    join, dirname, basename,
    within(root, path) {
      const rel = relative(root, path);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    },
    resolve: (base, path) => resolve(base, path),
  },

  real: (path) => Promise.resolve(realPath(path)),

  openSession: (path, registry) =>
    Promise.resolve(openNodeSession(path, registry)),
  openReader: (path) => {
    const db = openNodeDatabase(path, { readOnly: true });
    return Promise.resolve({
      exec: db.exec,
      close: () => { db.close(); return Promise.resolve(); },
    });
  },

  exists: (path) => Promise.resolve(existsSync(path)),
  stat: async (path) => {
    try {
      const st = statSync(path);
      return { size: st.size, modified: st.mtime.toISOString() };
    } catch {
      return null;
    }
  },
  readBytes: async (path, range) => {
    if (range === undefined) return new Uint8Array(readFileSync(path));
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(range.length);
      const n = readSync(fd, buf, 0, range.length, range.offset);
      return new Uint8Array(buf.subarray(0, n));
    } finally {
      closeSync(fd);
    }
  },
  readDir: async (path) => {
    const out: PlatformDirEntry[] = [];
    for (const name of readdirSync(path)) {
      try {
        const st = statSync(join(path, name));
        out.push({
          name,
          kind: st.isDirectory() ? "dir" : st.isFile() ? "file" : "other",
          size: st.size, modified: st.mtime.toISOString(),
        });
      } catch {
        // unreadable entry: leave it out
      }
    }
    return out;
  },
  readText: async (path) => readFileSync(path, "utf8"),
  appendText: async (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, text);
  },
  createFile: async (path, bytes) => {
    writeFileSync(path, bytes, { flag: "wx" });
  },
  mkdir: async (path) => { mkdirSync(path, { recursive: true }); },
  remove: async (path) => { rmSync(path, { force: true }); },

  sha1: async (text) => createHash("sha1").update(text).digest("hex"),
};
