import docsMeta from '../../content/docs/_meta';
import { redirect } from 'next/navigation';

const RESERVED_META_KEYS = new Set(['*', 'index']);

const getFirstDocsEntryPath = () => {
  const firstEntry = Object.entries(docsMeta).find(([key, value]) => {
    if (RESERVED_META_KEYS.has(key)) {
      return false;
    }
    if (value && typeof value === 'object' && 'display' in value) {
      return value.display !== 'hidden';
    }
    return true;
  })?.[0];

  if (!firstEntry) {
    throw new Error('content/docs/_meta.ts must define at least one visible docs entry.');
  }

  return `/docs/${firstEntry}`;
};

export default function HomePage() {
  redirect(getFirstDocsEntryPath());
}
