// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";

/**
 * A view's options object remembered per browser: a preference of
 * whoever is looking, not film data, so localStorage rather than the
 * .scf. `withDefaults` repairs whatever was stored (an older shape,
 * garbage) into a whole options object. Storage can throw (private
 * windows, blocked site data); the defaults then apply for the session.
 */
export function useRememberedOptions<T extends object>(
    key: string, withDefaults: (saved: unknown) => T):
    [T, (patch: Partial<T>) => void] {
  const [opts, setOpts] = useState<T>(() => {
    try {
      return withDefaults(JSON.parse(localStorage.getItem(key) ?? "null"));
    } catch {
      return withDefaults(null);
    }
  });
  const patch = (p: Partial<T>): void => {
    setOpts((prev) => {
      const next = { ...prev, ...p };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Not remembered this time.
      }
      return next;
    });
  };
  return [opts, patch];
}
