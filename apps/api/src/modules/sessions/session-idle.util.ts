/**
 * Shared logic for the server-enforced idle-session timeout. Kept in one
 * place so the per-request access strategy and the refresh-rotation path
 * apply the exact same rule.
 */

/**
 * Minimum gap between `lastSeenAt` writes. We only persist activity at most
 * once per this interval so an active session doesn't incur a DB write on
 * every request — idle detection is therefore accurate to within one
 * interval, which is fine for a minutes-scale timeout.
 */
export const TOUCH_INTERVAL_MS = 60_000;

/** True when the session has seen no activity for `idleMs` or longer. */
export function isIdle(
  lastSeenAt: Date,
  idleMs: number,
  now: Date = new Date(),
): boolean {
  return now.getTime() - lastSeenAt.getTime() >= idleMs;
}

/** True when a throttled `lastSeenAt` write is due. */
export function shouldTouch(
  lastSeenAt: Date,
  now: Date = new Date(),
): boolean {
  return now.getTime() - lastSeenAt.getTime() >= TOUCH_INTERVAL_MS;
}
