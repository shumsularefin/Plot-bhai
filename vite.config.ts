/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/** Commit and date of this build, recorded in methods texts and analysis records. */
function buildId(): string {
  const date = new Date().toISOString().slice(0, 10);
  try {
    const commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return `${commit}, ${date}`;
  } catch {
    return `unknown commit, ${date}`;
  }
}

// JSX is compiled by Vite's built-in transform using `jsxImportSource: "preact"`
// from tsconfig.json, so no framework plugin is needed.
export default defineConfig({
  define: { __BUILD__: JSON.stringify(buildId()) },
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
