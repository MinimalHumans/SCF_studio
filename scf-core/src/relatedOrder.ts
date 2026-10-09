// SPDX-License-Identifier: Apache-2.0
import type { Row } from "./db.ts";

/**
 * §8.6's order for the rows relating assets to one entity: `order`
 * ascending, rows with none after rows with one, then row id. A
 * storyboard's panels are a sequence, and attachment order is not it.
 */
export function byRelatedOrder(a: Row, b: Row): number {
  const oa = a["order"], ob = b["order"];
  const na = oa === null || oa === undefined, nb = ob === null || ob === undefined;
  if (na !== nb) return na ? 1 : -1;
  if (!na && Number(oa) !== Number(ob)) return Number(oa) - Number(ob);
  return Number(a["id"]) - Number(b["id"]);
}
