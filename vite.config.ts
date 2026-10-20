/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// JSX is compiled by Vite's built-in transform using `jsxImportSource: "preact"`
// from tsconfig.json, so no framework plugin is needed.
export default defineConfig({
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    // Lets tests read design tokens with `?raw` (Vitest blanks CSS by default).
    css: { include: [/tokens\.css/] },
  },
});
