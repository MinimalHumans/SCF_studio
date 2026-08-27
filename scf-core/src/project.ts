// SPDX-License-Identifier: Apache-2.0
/**
 * project.ts — what makes a folder a project.
 *
 * P2 of the assets plan. A project is a folder, not a file: the File
 * System Access API cannot return a parent directory from a file handle,
 * so a `.scf` opened on its own can never see what sits beside it. One
 * directory-picker gesture yields the root, the `.scf` inside it, and
 * the asset tree, under a single permission grant.
 *
 * The rule (conventions §9): scan the root only, non-recursive, for
 * `*.scf`. Exactly one is a valid project. Zero or several is malformed
 * — reported for the user to resolve, never guessed at. A `.scf` in a
 * subfolder is not a project candidate; those are layer candidates and
 * nothing here looks at them.
 *
 * Discovery is an OPTIMISATION, not the mechanism. Directory listing
 * turned out not to be reliably available: a locked-down Windows
 * machine returned zero entries for an ordinary Desktop folder, through
 * three separate iterators, with permission granted and nothing thrown —
 * and did the same in a bare DevTools console, so no application code
 * was involved. What a project needs is the root handle plus the
 * `.scf`; when listing cannot supply the second, the user names it, and
 * the resulting session is identical in every respect.
 *
 * This module is deliberately free of any browser type. It takes a list
 * of names and returns a decision, so the rule is testable without a
 * directory handle, and the adapter above it only does I/O.
 */

export type ProjectFindingKind =
  | "no-project-file"
  | "several-project-files"
  | "sidecar-present";

export interface ProjectFinding {
  kind: ProjectFindingKind;
  candidates: string[];
  message: string;
}

export interface ProjectPick {
  /** The single `.scf` at the root, or null when the rule cannot decide. */
  file: string | null;
  /** Every root-level `.scf`, sorted. Length 1 on a healthy project. */
  candidates: string[];
  /** Everything the scan actually saw, sorted. Carried so a "no .scf
   *  here" report can show its evidence — a finding that only says what
   *  is absent cannot be argued with, and the first time this rule was
   *  wrong there was nothing in the message to diagnose it from. */
  seen: string[];
  findings: ProjectFinding[];
}

/** SQLite's write-ahead sidecars, which are not projects. */
const SIDECAR = /\.scf-(wal|shm|journal)$/i;

export function isProjectFile(name: string): boolean {
  if (name.startsWith(".")) return false;   // dotfiles, resource forks
  if (SIDECAR.test(name)) return false;
  return name.toLowerCase().endsWith(".scf");
}

/**
 * Decide which file in a root listing is the project.
 *
 * `names` is the root's own entries — files only, no paths. Passing
 * subfolder contents would break the rule the caller is asking about,
 * so the adapter filters to files before calling.
 */
export function chooseProjectFile(names: readonly string[]): ProjectPick {
  const seen = [...names].sort((a, b) => a.localeCompare(b));
  const candidates = names.filter(isProjectFile).sort((a, b) =>
    a.localeCompare(b));
  const findings: ProjectFinding[] = [];

  if (names.some((n) => SIDECAR.test(n))) {
    findings.push({
      kind: "sidecar-present", candidates: names.filter((n) =>
        SIDECAR.test(n)),
      message: "this folder holds SQLite sidecar files, which usually " +
               "means the project is open somewhere else",
    });
  }

  if (candidates.length === 0) {
    findings.push({
      kind: "no-project-file", candidates: [],
      message: seen.length === 0
        ? "this folder scanned as empty. Directory listing is not " +
          "guaranteed — managed machines, enterprise policy and some " +
          "synced or virtualised folders all return no entries on a " +
          "folder that plainly has contents, with the grant succeeding " +
          "and nothing thrown. Naming the .scf directly is the ordinary " +
          "way in when that happens; the folder itself is already " +
          "connected either way."
        : `no .scf file at the root of this folder — a project is a ` +
          `folder with exactly one .scf in it. Saw: ${seen.join(", ")}`,
    });
    return { file: null, candidates, seen, findings };
  }

  if (candidates.length > 1) {
    findings.push({
      kind: "several-project-files", candidates,
      message: `${candidates.length} .scf files at the root of this ` +
               `folder — a project has exactly one, and referenced files ` +
               `belong in a subfolder`,
    });
    return { file: null, candidates, seen, findings };
  }

  return { file: candidates[0] ?? null, candidates, seen, findings };
}

/**
 * The other order: the `.scf` first, its folder second.
 *
 * A file picker yields a handle with no route to its parent, so the
 * folder has to be named separately. That sounds like the same trust
 * problem as discovery, and it is not — it is strictly better, because
 * the pairing can be CHECKED. `FileSystemDirectoryHandle.resolve()`
 * answers "is this handle below this directory, and where", by
 * traversal rather than enumeration, so it works on the machines where
 * the root scan returns nothing.
 *
 * Discovery has to guess which of several `.scf` files was meant.
 * This never guesses: the user has already said which file, and the
 * only open question is whether the folder they then picked is the one
 * that file lives at the root of. Three answers, all of them evidence:
 *
 *  - `at-root`      the folder holds the file directly. This is a
 *                   project (conventions §9) and `@project` is it.
 *  - `below-root`   the file is real but sits in a subfolder, so the
 *                   picked folder is an ancestor rather than the
 *                   project. Every asset identifier would be addressed
 *                   from the wrong place.
 *  - `outside-root` the file is not below the folder at all. Usually
 *                   the wrong folder, occasionally two copies of the
 *                   same project — and handle identity, not filename,
 *                   is what tells those apart.
 *
 * Browser-free, like the rest of this module: it takes two names and a
 * `resolve()` answer and returns a decision.
 */
export type RootPairingKind = "at-root" | "below-root" | "outside-root";

export interface RootPairing {
  kind: RootPairingKind;
  /** Where the file sits inside the folder, or null when it does not. */
  path: string | null;
  /** Said to the user. Names both sides, because "wrong folder" with
   *  neither name in it is not something anyone can act on. */
  message: string;
}

/**
 * @param folderName  the picked directory's own name.
 * @param fileName    the open `.scf`'s name.
 * @param segments    `resolve()`'s answer: path segments from the
 *                    folder down to the file, or null when the file is
 *                    not below it. An empty array means the handles are
 *                    the same object, which for a file and a directory
 *                    cannot happen — treated as not-below rather than
 *                    trusted.
 */
export function classifyRootPairing(
  folderName: string,
  fileName: string,
  segments: readonly string[] | null,
): RootPairing {
  if (segments === null || segments.length === 0) {
    return {
      kind: "outside-root", path: null,
      message: `${fileName} is not inside ${folderName}. A project ` +
               `folder is the folder that file sits in — pick that one, ` +
               `and note that a second copy of the same project ` +
               `elsewhere on disk is a different folder even under the ` +
               `same name.`,
    };
  }
  const path = segments.join("/");
  if (segments.length > 1) {
    return {
      kind: "below-root", path,
      message: `${fileName} is inside ${folderName}, but at ${path} ` +
               `rather than at its root. A project is the folder ` +
               `holding the .scf directly; assets addressed from here ` +
               `would resolve one or more levels too high.`,
    };
  }
  return {
    kind: "at-root", path,
    message: `${folderName} holds ${path} at its root.`,
  };
}
