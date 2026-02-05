'use client';

import { useEffect } from 'react';

type RevisionResponse = {
  revision?: unknown;
};

const getRevision = async () => {
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

    const tick = async () => {
      try {
        const revision = await getRevision();
        if (cancelled || !revision) {
          return;
        }
        if (lastRevision && revision !== lastRevision) {
          window.location.reload();
          return;
        }
        lastRevision = revision;
      } catch {
        // ignore (server restarting, transient network issues)
      }
    };

    void tick();
    const interval = window.setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return null;
}

