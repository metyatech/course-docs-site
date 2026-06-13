/**
 * In-process pub/sub bus for the dev-only auto-reload SSE stream.
 *
 * `bumpRevision()` increments the shared revision counter and broadcasts the
 * new value to all currently-connected SSE clients (see
 * `/api/dev/revision/stream`). This gives the docs page's `DevAutoReload`
 * component a reliable signal to call `window.location.reload()` after any
 * tutorial shot is saved — even when the underlying Next.js HMR has already
 * seen the file-system change and decided not to do a full reload.
 *
 * Only used in the Next.js Node.js runtime (not Edge). The module is
 * intentionally side-effect-free at import time.
 */

type Subscriber = (revision: string) => void;

const subscribers = new Set<Subscriber>();

let currentRevision = process.env.COURSE_DOCS_SITE_DEV_REVISION ?? "";

/** Subscribe to revision bumps. Returns an unsubscribe function. */
export const subscribe = (fn: Subscriber): (() => void) => {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
};

/** Get the current revision string. */
export const getRevision = (): string => currentRevision;

/**
 * Increment the revision and broadcast to all subscribers.
 * Called by the save API after a successful `saveTutorialShot`.
 */
export const bumpRevision = (): void => {
  const next = String(Date.now());
  currentRevision = next;
  for (const fn of subscribers) {
    try {
      fn(next);
    } catch {
      // Ignore errors from individual subscribers (e.g. closed streams).
    }
  }
};
