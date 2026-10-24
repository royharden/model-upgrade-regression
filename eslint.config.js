import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.agent-work/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { react },
    settings: { react: { version: '18.3' } },
    rules: { 'react/no-danger': 'error' },
  },
  { files: ['tools/**/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly' } } },
);
