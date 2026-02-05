'use client';

import { useEffect } from 'react';

type RevisionResponse = {
  revision?: unknown;
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

    return () => {
      cancelled = true;
      if (eventSource) {
        eventSource.close();
      }
    };
  }, []);

  return null;
}
