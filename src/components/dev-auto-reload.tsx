'use client';

import { useEffect } from 'react';

type RevisionResponse = {
  revision?: unknown;
};

const getRevisionOnce = async () => {
  const res = await fetch('/api/dev/revision', {
    cache: 'no-store',
    headers: {
      'cache-control': 'no-store',
    },
  });
  if (!res.ok) {
    return null;
  }
  const data = (await res.json()) as RevisionResponse;
  return typeof data.revision === 'string' ? data.revision : null;
};

export default function DevAutoReload() {
  useEffect(() => {
    let cancelled = false;
    let lastRevision = '';

    const applyRevision = (revision: string) => {
      if (cancelled || !revision) {
        return;
      }
      if (lastRevision && revision !== lastRevision) {
        window.location.reload();
        return;
      }
      lastRevision = revision;
    };

    // Prefer SSE to avoid spamming dev server logs with polling requests.
    let eventSource: EventSource | null = null;
    if (typeof window.EventSource === 'function') {
      eventSource = new EventSource('/api/dev/revision/stream');
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as RevisionResponse;
          if (typeof data.revision === 'string') {
            applyRevision(data.revision);
          }
        } catch {
          // ignore
        }
      };
    }

    const fallback = async () => {
      try {
        const revision = await getRevisionOnce();
        if (typeof revision === 'string') {
          applyRevision(revision);
        }
      } catch {
        // ignore
      }
    };

    void fallback();
    const interval = window.setInterval(() => void fallback(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (eventSource) {
        eventSource.close();
      }
    };
  }, []);

  return null;
}
