// SPDX-License-Identifier: Apache-2.0
/**
 * api.ts — how the window writes.
 *
 * Every change to the film goes through `call(name, ...args)`: a name
 * from scf-core's call table and that function's own arguments, as
 * plain data. The window never holds a write function. For now the
 * call runs here, in this page, against the working database; the
 * arguments and the result are passed through JSON first, so anything
 * that could not cross to the host (a `Set`, a callback, a class
 * instance) fails now, in development, instead of at the cutover.
 */

import {
  CALLS, UnknownCallError, type CallArgs, type CallName, type CallResult,
  type Callable,
} from "@scf-core/ops/calls.ts";
import { session } from "./store.ts";

const plain = <T,>(v: T): T =>
  v === undefined ? v : JSON.parse(JSON.stringify(v)) as T;

export async function call<K extends CallName>(
    name: K, ...args: CallArgs<K>): Promise<CallResult<K>> {
  if (!Object.hasOwn(CALLS, name)) throw new UnknownCallError(name);
  const list = [...args];
  while (list.length > 0 && list[list.length - 1] === undefined) list.pop();
  const callable = CALLS[name] as unknown as Callable<unknown[], unknown>;
  // Serialised with every other write, and counted, as it will be on
  // the host.
  const result = await session.write((ctx) =>
    callable.run(ctx, plain(list)));
  return plain(result ?? null) as CallResult<K>;
}
