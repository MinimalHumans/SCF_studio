// SPDX-License-Identifier: Apache-2.0
/**
 * retry.ts — try again, a little later, a bounded number of times.
 *
 * The host starts with the dev server but not before it: on a slow
 * filesystem the page can load seconds before the host is listening.
 * Failing the first attempt would turn "starting up" into an error
 * screen, so the connection retries with a growing delay and gives up
 * only after the delays have added up to something a person would call
 * broken.
 */

export interface RetryOptions {
  /** Total attempts, the first included. */
  attempts?: number;
  /** Delay before the second attempt; doubles each time. */
  baseMs?: number;
  /** Ceiling for one delay. */
  maxMs?: number;
  /** Return false to stop at once (a refusal that waiting will not fix). */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Called before each wait, for a "still starting…" message. */
  onWait?: (attempt: number, delayMs: number, error: unknown) => void;
  /** Injected so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => { setTimeout(resolve, ms); });

/** Delays: 250, 500, 1000, 2000, 2000… ≈ 30 s over 15 attempts. */
export async function withRetry<T>(
    work: (attempt: number) => Promise<T>,
    options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 15;
  const base = options.baseMs ?? 250;
  const max = options.maxMs ?? 2000;
  const sleep = options.sleep ?? wait;
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await work(attempt);
    } catch (e) {
      last = e;
      if (attempt === attempts) break;
      if (options.shouldRetry?.(e, attempt) === false) break;
      const delay = Math.min(max, base * 2 ** (attempt - 1));
      options.onWait?.(attempt, delay, e);
      await sleep(delay);
    }
  }
  throw last;
}
