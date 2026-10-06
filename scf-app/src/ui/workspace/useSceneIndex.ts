// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { exec, useStore } from "../../state/store.ts";
import {
  readSceneIndex, type SceneIndex,
} from "../../editor/characterPresence.ts";

/** Which scene each script line is in, re-read on every write. */
export function useSceneIndex(): SceneIndex | null {
  const revision = useStore((s) => s.revision);
  const [index, setIndex] = useState<SceneIndex | null>(null);
  useEffect(() => {
    let cancelled = false;
    void readSceneIndex(exec).then((i) => { if (!cancelled) setIndex(i); });
    return () => { cancelled = true; };
  }, [revision]);
  return index;
}
