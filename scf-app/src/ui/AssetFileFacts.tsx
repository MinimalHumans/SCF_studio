// SPDX-License-Identifier: Apache-2.0
/**
 * AssetFileFacts — what the file itself says (metadata, not storage).
 *
 * Read from the bytes every time it is shown and never written to the
 * .scf. The row holds an address; dimensions, channels and duration are
 * facts about the CONTENT, and storing them would be a second copy of a
 * truth that changes without asking (conventions §2).
 *
 * The accepted cost is that none of this is queryable — a filter over
 * thousands of assets would mean reading thousands of files. If it
 * needs storing to be queried, it does not get queried.
 *
 * Two sources, in the order they are cheap:
 *   header  — the first 96KB, parsed in scf-core. No decoding, works
 *             for EXR and glTF where preview cannot.
 *   element — duration and intrinsic size for audio and video, which
 *             only the browser can report, and only by loading.
 */

import { Fragment, useEffect, useState } from "react";
import {
  HEADER_BYTES, readHeaderMetadata, type FileMetadata,
} from "@scf-core/fileMetadata.ts";
import { parseIdentifier } from "@scf-core/assets.ts";
import { readAssetBytes } from "../files/assetLocator.ts";
import { useStore } from "../state/store.ts";

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function AssetFileFacts({ identifier }: {
  identifier: string | null;
}): JSX.Element | null {
  const { projectRoot } = useStore();
  const [meta, setMeta] = useState<FileMetadata | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [modified, setModified] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  const root = projectRoot as FileSystemDirectoryHandle | null;
  const parsed = identifier === null ? null : parseIdentifier(identifier);

  useEffect(() => {
    let cancelled = false;
    setMeta(null);
    setSize(null);
    setModified(null);
    setMissing(false);

    void (async () => {
      if (parsed === null || root === null || parsed.root !== "project") {
        return;
      }
      const read = await readAssetBytes(root, parsed.path, HEADER_BYTES);
      if (cancelled) return;
      if (read === null) { setMissing(true); return; }
      setSize(read.size);
      setModified(new Date(read.lastModified).toLocaleString());
      setMeta(readHeaderMetadata(new Uint8Array(read.bytes)));
    })();

    return () => { cancelled = true; };
  }, [identifier, root]);

  if (identifier === null) return null;
  if (missing) return null;          // resolution already reports this
  if (size === null) return null;

  return (
    <section className="asset-facts">
      <h4>File</h4>
      <dl className="identity-facts">
        <dt>size</dt>
        <dd>{humanBytes(size)}</dd>
        {modified !== null && (
          <>
            <dt>modified</dt>
            <dd>{modified}</dd>
          </>
        )}
        {meta !== null && meta.width !== null && (
          <>
            <dt>dimensions</dt>
            <dd>
              {meta.width}
              {meta.height !== null ? ` × ${meta.height}` : ""}
            </dd>
          </>
        )}
        {(meta?.fields ?? []).map((f) => (
          // A <dl> pairs dt with dd, so each pair needs a keyed
          // Fragment — keys on the children of an anonymous fragment
          // are not the fragment's key, which is what React was
          // warning about.
          <Fragment key={f.label}>
            <dt>{f.label}</dt>
            <dd className={f.value.length > 120
              ? "asset-facts-long" : undefined}>
              {f.value}
            </dd>
          </Fragment>
        ))}
      </dl>
      {meta?.note !== null && meta?.note !== undefined && (
        <p className="muted asset-facts-note">{meta.note}</p>
      )}
      <p className="muted asset-facts-note">
        Read from the file, not stored in this project.
      </p>
    </section>
  );
}
