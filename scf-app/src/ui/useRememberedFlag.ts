// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";

/**
 * A view toggle remembered per browser: a preference, not film data,
 * so it lives in localStorage rather than the .scf. Storage can throw
 * (private windows, blocked site data); the default then applies and
 * the toggle still works for the session.
 */
export function useRememberedFlag(key: string, fallback = false):
    [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v === "1";
    } catch {
      return fallback;
    }
  });
  const set = (v: boolean): void => {
    setValue(v);
    try {
      localStorage.setItem(key, v ? "1" : "0");
    } catch {
      // Not remembered this time.
    }
  };
  return [value, set];
}
