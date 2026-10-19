// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import { HostUnavailableError, connectHost } from "../src/host/connection";
import { withRetry } from "../src/host/retry";

const noSleep = (): Promise<void> => Promise.resolve();

describe("retry", () => {
  test("returns the first success and does not wait", async () => {
    const sleep = vi.fn(noSleep);
    expect(await withRetry(() => Promise.resolve(7), { sleep })).toBe(7);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("backs off exponentially up to the ceiling", async () => {
    const delays: number[] = [];
    await expect(withRetry(() => Promise.reject(new Error("no")), {
      attempts: 7, baseMs: 100, maxMs: 500, sleep: noSleep,
      onWait: (_a, d) => delays.push(d),
    })).rejects.toThrow("no");
    expect(delays).toEqual([100, 200, 400, 500, 500, 500]);
  });

  test("succeeds once the thing comes up", async () => {
    let n = 0;
    const r = await withRetry(() => {
      n += 1;
      return n < 4 ? Promise.reject(new Error("starting")) : Promise.resolve(n);
    }, { sleep: noSleep });
    expect(r).toBe(4);
  });

  test("stops at once when told waiting will not help", async () => {
    let n = 0;
    await expect(withRetry(() => {
      n += 1;
      return Promise.reject(new Error("refused"));
    }, { shouldRetry: () => false, sleep: noSleep })).rejects.toThrow();
    expect(n).toBe(1);
  });
});

const answering = () => Promise.resolve({
  request: (method: string) => Promise.resolve(
    method === "hello" ? { protocol: 1, version: "0" } : null),
  onEvent: () => () => {},
  onClose: () => () => {},
  close: () => Promise.resolve(),
});

describe("connecting", () => {
  test("retries until the host answers", async () => {
    let tries = 0;
    const client = await connectHost({
      retry: { sleep: noSleep },
      transport: () => {
        tries += 1;
        return tries < 3
          ? Promise.reject(new HostUnavailableError("starting", false))
          : answering();
      },
    });
    expect(tries).toBe(3);
    await client.dispose();
  });

  test("a refusal fails immediately with its own message", async () => {
    let tries = 0;
    await expect(connectHost({
      retry: { sleep: noSleep },
      transport: () => {
        tries += 1;
        return Promise.reject(new HostUnavailableError("not allowed", true));
      },
    })).rejects.toThrow("not allowed");
    expect(tries).toBe(1);
  });

  test("gives up after the attempts are spent", async () => {
    await expect(connectHost({
      retry: { attempts: 3, sleep: noSleep },
      transport: () =>
        Promise.reject(new HostUnavailableError("nope", false)),
    })).rejects.toThrow("nope");
  });

  test("outside the desktop shell there is no host, and it says so at " +
       "once", async () => {
    await expect(connectHost({ retry: { sleep: noSleep } }))
      .rejects.toMatchObject({ refused: true, message:
        expect.stringContaining("desktop app") });
  });
});
