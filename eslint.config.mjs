import { FlatCompat } from '@eslint/eslintrc';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  ...compat.extends('next/core-web-vitals'),
  {
    ignores: ['out/**/*', '.next/**/*', '.next-test/**/*', '.course-content/**/*', 'test-results/**/*'],
  },
];

export default config;
