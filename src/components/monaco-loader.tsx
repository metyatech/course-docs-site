'use client';

import loader from '@monaco-editor/loader';

const monacoBasePath = '/monaco-editor/min/vs';

loader.config({ paths: { vs: monacoBasePath } });

export default function MonacoLoader() {
  return null;
}
