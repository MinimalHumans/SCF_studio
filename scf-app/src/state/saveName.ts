/**
 * Filename the Save-As picker opens with.
 *
 * `bump` (Save As) proposes the next version so the common case — keep
 * the working file, write the next one — is a single Return:
 *   hollow_creek.scf      → hollow_creek_v2.scf
 *   hollow_creek_v2.scf   → hollow_creek_v3.scf
 *   hollow_creek-004.scf  → hollow_creek-005.scf   (zero padding kept)
 * A project that has no file yet (the demo, a new project) is only given
 * the extension — there is no earlier version to step past.
 */
export function suggestSaveAsName(
    current: string | null, bump = false): string {
  if (current === null || current.trim() === "") return "project.scf";
  const name = current;
  const hasExt = /\.scf$/i.test(name);
  const base = hasExt ? name.slice(0, -4) : name;
  if (!bump || !hasExt) return `${base || "project"}.scf`;
  const versioned = /^(.*?)([._-]?v)(\d+)$/i.exec(base);
  if (versioned !== null) {
    return `${versioned[1]}${versioned[2]}` +
           `${String(Number(versioned[3]) + 1)}.scf`;
  }
  const numbered = /^(.*?)([._-])(\d+)$/.exec(base);
  if (numbered !== null) {
    const digits = numbered[3] ?? "";
    const next = String(Number(digits) + 1).padStart(digits.length, "0");
    return `${numbered[1]}${numbered[2]}${next}.scf`;
  }
  return `${base}_v2.scf`;
}

/**
 * Filename an exported .fountain lands under.
 *
 * It used to be the constant "screenplay.fountain" for every project,
 * which is how an export can end up sitting next to — or on top of — the
 * file you imported from. Naming it after the project makes the
 * relationship obvious and stops two projects' exports colliding in a
 * downloads folder.
 *
 * The import itself never writes anywhere: it reads through a plain file
 * input, which hands the page a read-only snapshot and no way back to
 * the disk. Export is the only path that produces a fountain file, and
 * it always produces a NEW one.
 */
export function suggestExportName(current: string | null): string {
  const base = (current ?? "").trim().replace(/\.scf$/i, "").trim();
  return base === "" ? "screenplay.fountain" : `${base}.fountain`;
}
