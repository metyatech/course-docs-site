/**
 * The Next routing redirect handles `/` before this page is rendered.
 * This metadata-only page keeps Nextra's root `_meta.ts` `index` entry valid
 * without reading course content at runtime.
 */
export default function HomePage() {
  return null;
}
