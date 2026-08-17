/**
 * The words this screen uses, and the two timings it depends on.
 *
 * Its own module because all five pieces of the door console take the labels, and both
 * timings are felt rather than seen: how long a verdict stays on screen before the next
 * scan can replace it, and how long a search waits before asking the server.
 */

import type { AdminDictionary } from "@sailo/i18n/admin";

export type CheckinLabels = AdminDictionary["checkin"];

export const RESULT_HOLD_MS = 1_600;
export const SEARCH_DEBOUNCE_MS = 220;
