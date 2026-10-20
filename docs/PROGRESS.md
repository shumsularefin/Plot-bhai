# Progress

## Stage 0: project foundation (done)

Branch `stage-0-foundation`. No science code yet.

### What was built

- **Tooling:** Vite 8, TypeScript 6.0 in strict mode (plus `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`), Preact 11, ESLint 10 with typescript-eslint, Prettier, Vitest 5.
  Folder structure from CLAUDE.md; empty folders hold a `.gitkeep`.
- **Design system** (`src/ui/tokens.css`): neutral palette with one accent colour, system font
  stack, type scale, 4 px spacing scale, radii, a 44 px touch-target token and the Okabe-Ito
  colour-blind safe plot palette. Light and dark themes follow the OS by default; the header
  button switches between system, light and dark. `tests/tokens.test.ts` checks that every text
  colour pair meets WCAG AA (4.5:1) and that borders and the focus ring meet 3:1, in both themes.
- **App shell:** header, footer and a centred content column with a 16 px side gutter on phones
  (24 px from 768 px, 32 px from 1280 px). A hash router (`#/`, `#/xrd`) needs no server rewrites.
- **Home page:** four tool cards. XRD opens its wizard; UV-Vis, FTIR and Particle size show
  "Coming soon".
- **Wizard** (`src/ui/wizard/`): stepper (the full step list from 1024 px; a compact "Step 2 of 8"
  line with a progress bar on smaller screens), Back and Next, a per-step `validate` hook that
  returns a plain-language message, focus moved to the step heading on step change, "Start over"
  with confirmation, and a notice if the browser blocks saving.
- **Persistence** (`src/ui/persist/`): a small store mirrored to IndexedDB (debounced writes, an
  immediate write when the page is hidden, a version number so a later stage can discard
  incompatible saved data). A refresh resumes at the same step with the same data.
- **XRD placeholder:** the eight XRD steps in wizard order. Only "Upload" has content: a
  required sample name (to exercise validation and persistence) and a "What is 2θ?" help popover.
- **Help popover** (`src/ui/HelpTip.tsx`): "What is this?" button with a 44 px target. Closes with
  Escape (returning focus), the close button or a tap outside, and stays inside the viewport.
- **Hosting:** `firebase.json` (Hosting only, long cache for hashed assets, `no-cache` elsewhere,
  security headers and a strict CSP) and `.firebaserc` with the placeholder
  `YOUR_FIREBASE_PROJECT_ID`.
- **CI:** `ci.yml` runs lint, type check, tests, build and the bundle-size check on every pull
  request and on pushes to `main`. `preview.yml` deploys pull requests to a Firebase preview
  channel and skips itself until the setup in README.md is done.

### Dependencies and why

| Package                                        | Kind    | Why                                                                          |
| ---------------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| preact                                         | runtime | UI framework required by CLAUDE.md.                                          |
| vite                                           | dev     | Build tool and dev server.                                                   |
| typescript                                     | dev     | Type checking. Pinned to `~6.0` because typescript-eslint supports `<6.1`.   |
| vitest, jsdom                                  | dev     | Unit tests; jsdom provides a DOM for component tests.                        |
| @testing-library/preact                        | dev     | Renders components in tests and queries them by role and label.              |
| fake-indexeddb                                 | dev     | In-memory IndexedDB so persistence can be tested in Node.                    |
| eslint, @eslint/js, typescript-eslint, globals | dev     | Linting.                                                                     |
| eslint-plugin-react-hooks                      | dev     | Catches hook ordering and missing-dependency bugs (works with Preact hooks). |
| prettier, eslint-config-prettier               | dev     | Formatting, and turning off ESLint rules that conflict with it.              |

D3 submodules are not installed yet; they arrive with the first plot.

### Decisions

- **No `@preact/preset-vite`.** Vite compiles JSX itself using `jsxImportSource: "preact"` from
  tsconfig. This saves a Babel-based plugin and its dependencies. The cost is that the dev server
  does a full page reload on change instead of hot-swapping components; saved state survives
  reloads, so little is lost.
- **Own IndexedDB wrapper** (about 50 lines) rather than the `idb` package.
- **Hash routing** rather than a router library, because there are only a handful of routes.
- **Theme before first paint:** `public/theme-init.js` is a tiny external script, because the CSP
  forbids inline scripts. The theme choice lives in localStorage, as a per-browser convenience.
- **CSP:** `default-src 'none'`, with only same-origin scripts, styles, images (plus `data:`/`blob:`
  for later exports), fonts, connections and workers. `frame-ancestors 'none'`,
  `base-uri 'none'`, `form-action 'none'`, `object-src 'none'`.

### Verification (real results)

- `npm run lint`: pass. `npm run typecheck`: pass.
- `npm test`: 44 tests pass (store, wizard, help popover, colour contrast).
- `npm run build`: pass. `npm run size`: initial JavaScript 8.1 KB gzipped (budget 150 KB); the
  XRD chunk (about 3 KB) is lazy-loaded.
- Browser check in headless Chromium, serving `dist/` with the `firebase.json` headers, at 360,
  768, 1280 and 1920 px in light and dark: no horizontal scroll (including with the help popover
  open), no console errors or CSP violations. Validation blocks Next with its message; after
  filling the sample name, moving to step 3 and reloading, the wizard reopened on step 3 with the
  name kept. The XRD card opens with the keyboard alone.
- Lighthouse 13 (mobile, simulated throttling, local server): home page performance 100 (LCP 1.2 s,
  CLS 0, TBT 0 ms); XRD wizard performance 100 (LCP 1.4 s, CLS 0). Accessibility, best practices
  and SEO 100 on both. This was a local server, not Firebase; re-check on the first preview URL.
- `npm run dev` starts and serves the app.

### Known issues and to-dos

- **To verify:** the Okabe-Ito plot colours in `tokens.css` are from Okabe and Ito, "Color
  Universal Design" (2008). Please confirm the hex values against the source.
- The CI and preview workflows have not run on GitHub yet; the first pull request is their first
  run. The preview workflow needs the manual setup in README.md.
- No workflow deploys the live site on merge yet; live deploys are manual (see README).
- The CSP `connect-src 'self'` must be widened when the optional Gemini feature (Firebase AI
  Logic) is added in the last stage.
- Below 1024 px the stepper is compact, so earlier steps are reached with Back rather than by
  tapping a step.
- No "Try with example data" button yet. It needs real upload and parsing, so it arrives with the
  XRD upload stage.
- Undo per processing step is not built yet; the wizard only has "Start over". Undo belongs with
  the first processing step.

### Next stage

Stage 1: not started. Waiting for your go-ahead and the stage brief.
