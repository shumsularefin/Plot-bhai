import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', '.firebase'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { globals: globals.browser, sourceType: 'script' },
  },
  {
    files: ['scripts/**/*.{js,mjs,ts}', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    // Callbacks passed to page.evaluate and page.waitForFunction run in the browser.
    files: ['scripts/e2e.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  prettier,
);
