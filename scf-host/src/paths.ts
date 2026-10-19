// SPDX-License-Identifier: Apache-2.0
/**
 * paths.ts — path spelling without `node:path`, for a host that runs in
 * the window (platform.ts `PathOps`).
 *
 * Only what the host does with paths it already holds in their `real`
 * form: put a name under a folder, go up one, take the last name, and
 * ask whether one path is under another. Windows compares without
 * regard to case, as its file systems do; POSIX does not.
 */

import type { PathOps } from "./platform.ts";

function ops(sep: "\\" | "/", caseless: boolean): PathOps {
  const isSep = (c: string | undefined): boolean =>
    c === sep || (sep === "\\" && c === "/");
  const anySeps = sep === "\\" ? /[\\/]+/g : /\/+/g;

  /** How long the root at the start of `path` is: `/`, `C:\`, `\\srv\share\`. */
  const rootLength = (path: string): number => {
    if (sep === "/") return path.startsWith("/") ? 1 : 0;
    if (/^[A-Za-z]:/.test(path)) return isSep(path[2]) ? 3 : 2;
    if (isSep(path[0]) && isSep(path[1])) {
      const m = /^[\\/]{2}[^\\/]+[\\/]+[^\\/]+[\\/]?/.exec(path);
      return m === null ? path.length : m[0].length;
    }
    return isSep(path[0]) ? 1 : 0;
  };

  /** One separator between names, none trailing; the root kept whole. */
  const normalize = (path: string): string => {
    const n = rootLength(path);
    const root = path.slice(0, n).replace(/[\\/]/g, sep);
    const rest = path.slice(n).replace(anySeps, sep);
    const start = rest.startsWith(sep) ? 1 : 0;
    const end = rest.endsWith(sep) ? -1 : undefined;
    return root + rest.slice(start, end);
  };

  const key = (path: string): string =>
    caseless ? normalize(path).toLowerCase() : normalize(path);

  return {
    join(...parts) {
      return normalize(parts.filter((p) => p !== "").join(sep));
    },
    dirname(path) {
      const p = normalize(path);
      const root = rootLength(p);
      const cut = p.lastIndexOf(sep);
      if (cut < root) return p.slice(0, root) || ".";
      return p.slice(0, cut === root - 1 ? root : cut);
    },
    basename(path) {
      const p = normalize(path);
      return p.slice(Math.max(rootLength(p), p.lastIndexOf(sep) + 1));
    },
    within(root, path) {
      const r = key(root);
      const p = key(path);
      return p === r || p.startsWith(r.endsWith(sep) ? r : r + sep);
    },
    resolve(base, path) {
      let whole = rootLength(path) > 0 ? path : `${base}${sep}${path}`;
      // `\films` is on the base's drive; `C:films` is taken as `C:\films`.
      if (sep === "\\" && rootLength(whole) === 1 && !isSep(whole[1])) {
        whole = base.slice(0, rootLength(base)) + whole.slice(1);
      } else if (sep === "\\" && rootLength(whole) === 2) {
        whole = `${whole.slice(0, 2)}\\${whole.slice(2)}`;
      }
      const n = rootLength(whole);
      const root = whole.slice(0, n).replace(/[\\/]/g, sep);
      const names: string[] = [];
      for (const name of whole.slice(n).split(anySeps)) {
        if (name === "" || name === ".") continue;
        if (name === "..") names.pop();
        else names.push(name);
      }
      return normalize(root + names.join(sep));
    },
  };
}

export const windowsPaths: PathOps = ops("\\", true);
export const posixPaths: PathOps = ops("/", false);
