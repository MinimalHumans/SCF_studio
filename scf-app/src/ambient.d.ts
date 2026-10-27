// SPDX-License-Identifier: Apache-2.0
/**
 * Ambient declarations: the build identity Vite injects.
 */

/** Build identity, replaced at build time by vite.config.ts. */
declare const __APP_VERSION__: string;
/** Short commit, or "unknown" when built without git. */
declare const __APP_COMMIT__: string;
/** Build date, YYYY-MM-DD. */
declare const __APP_BUILT__: string;
