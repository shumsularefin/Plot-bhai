# Project: XRD Toolkit (working name)

Read this file fully at the start of every session. It is the source of truth for the whole project. Also read docs/PROGRESS.md if it exists.

## 1. What we are building

A free, fast, client-side web app that helps early-career researchers analyse materials characterisation data through a simple step-by-step wizard. Five tools share one design system, one plotting engine and one export system:

1. XRD analysis (main tool, built first)
2. UV-Vis analysis (absorbance, transmittance and reflectance, Tauc band gap)
3. FTIR analysis (absorbance and transmittance, peak table, functional group suggestions)
4. Particle size distribution from SEM or TEM images (ImageJ-style measuring)
5. Thermal analysis: TGA, DSC and combined TGA-DSC (mass loss steps, event suggestions, calcination temperature suggestions, enthalpies, glass transition)

The user is a researcher who writes papers. Results must be scientifically correct, traceable and publication ready. Beginners must be able to finish an analysis without reading a manual.

## 2. Hard constraints

- Hosting is Firebase Spark (free) for the site. No Cloud Functions, no paid services, no user accounts. Two backends are allowed, both on the Cloudflare Workers free plan and approved by the owner in October 2026: the COD lookup Worker (`worker/`, docs/cod-lookup.md), read-only, which answers only COD searches and single-CIF downloads; and the feedback Worker with a D1 database (`worker-feedback/`, docs/feedback.md), which counts visits, finished analyses and validations and keeps validation comments, published only after the owner approves them.
- All processing runs in the browser. Uploaded files never leave the user's device; only element symbols, formulas and COD numbers are sent to the COD lookup, and only a random browser ID, the analysis section name, the validation verdict and the user's comment are sent to the feedback Worker (IP addresses and browser IDs are stored only as salted hashes). No other analytics, no telemetry, no third-party CDNs or web fonts (self-host everything).
- The optional network features are the COD lookup, the feedback Worker and Gemini text generation through Firebase AI Logic (last stage). The site must work fully without them (CIF upload stays as the fallback).
- Do not bundle or fetch JCPDS/ICDD data. Reference patterns come from the open Crystallography Open Database (COD): a library precomputed at build time into small JSON files, plus any COD entry fetched through the lookup and calculated in the browser. The user may type a JCPDS number by hand to print in tables; the site never claims to have verified it.
- Never invent scientific data. This includes COD IDs, reference patterns, test expectations, published values and literature citations. If something cannot be verified (for example the network is blocked), stop, mark it TODO and tell me.

## 3. Tech stack (keep it small)

- Vite, TypeScript in strict mode, Preact for the UI.
- D3 submodules only for scales, axes and shapes (d3-scale, d3-axis, d3-shape, d3-array). Charts are rendered as SVG so the same markup exports to SVG and PNG.
- Vitest for tests, ESLint and Prettier for style.
- Heavy computation (peak fitting, image analysis) runs in Web Workers.
- Lazy-load every tool module. Lazy-load large libraries (for example OpenCV.js or a TIFF decoder) only inside the module that needs them, self-hosted.
- Session persistence in IndexedDB. Keep dependencies minimal and justify each new one in docs/PROGRESS.md.

Suggested structure:

```
src/core/        pure TypeScript science code, no UI imports, fully unit tested
src/modules/     xrd/, uvvis/, ftir/, particles/, thermal/
src/ui/          wizard, layout, plot components, design tokens
src/workers/     web workers
data/reference/  generated reference pattern JSON (from COD)
data/thermal/    thermal event rule tables and atomic weights (JSON, flagged for verification)
scripts/         build-time scripts (reference library builder)
tests/           unit tests and fixtures
docs/            PROGRESS.md and method notes
```

## 4. Scientific correctness rules

- Every formula lives in src/core with a doc comment stating the equation, the variable meanings and the units.
- Test with synthetic data where the true answer is known (for example generate peaks with a chosen width, then recover the size). Do not claim agreement with a published value unless you can verify it.
- Always show units. Angles in degrees for display, radians inside Scherrer-type formulas, and be explicit about which one a function expects.
- Default radiation is Cu K-alpha1, with other common anodes selectable. Use standard tabulated wavelengths, cite the source in a code comment, and flag them for my verification.
- Warnings must be plain language and shown where the problem happens (for example: "This peak is close to the instrument width, so the size is only a lower limit").
- Results that are estimates must be labelled as estimates. This applies to single crystal versus polycrystalline hints, automatic phase matching, thermal event assignments and calcination temperature suggestions.
- Thermal data: state the heat flow sign convention (exo up or exo down) on every DSC plot and table. Event assignments are always ranked suggestions with a plain-language reason, never certainties, and the app must say that TGA alone cannot identify evolved species. Rule tables (typical temperature ranges for events) live in JSON, cite their source, and are flagged for my verification. A suggested calcination temperature is a starting point to confirm experimentally, for example by XRD of samples calcined at a few temperatures.

## 5. UX rules

- Sequential wizard. One main action per step, clear Back and Next, visible progress, and a "Try with example data" button on every tool.
- Sensible defaults everywhere, all changeable. Short "What is this?" help on every technical term.
- Clean and minimal: neutral palette, one accent colour, system font stack, generous whitespace, light and dark themes, colour-blind safe plot colours.
- Responsive for every screen size. Mobile first. Test at 360, 768, 1280 and 1920 px wide. Touch targets at least 44 px. No horizontal page scroll. Plots resize and support touch zoom and pan.
- Accessibility: full keyboard use, labelled controls, AA contrast, respect reduced motion.
- Undo and reset on every processing step. Never lose the user's work on refresh.

## 6. Performance budget

- Initial JavaScript for the app shell at most 150 KB gzipped. Each tool loads on demand.
- Mobile Lighthouse performance score of 90 or more. Largest contentful paint under 2.5 s on a throttled mid-range phone.
- No layout shift. Heavy work never blocks the main thread.
- XRD files up to about 50,000 points must stay smooth. Images up to about 20 MP are analysed on a downscaled working copy with results mapped back to the original scale.
- CI checks bundle size and fails if the budget is exceeded.

## 7. Plot and export standards

- Publication-quality SVG first. Choice of Arial or Times fonts, inward ticks, proper symbols (2theta, italic letters, Greek letters, superscripts), adjustable line widths.
- Export presets for single column (about 85 mm) and double column (about 180 mm) journal widths.
- Export: SVG, PNG at 300 and 600 dpi, CSV for every table, and a JSON session file that can be re-imported.
- Generate a "Methods text" paragraph from the actual settings used (equation, K value, wavelength, correction method, reference ID) so the user can paste it into a paper.

## 8. Tools overview (details are in each stage prompt)

XRD wizard order: 1 Upload, 2 Clean data, 3 Choose material, 4 Compare reference phases, 5 Rietveld refinement (optional, basic), 6 Fit peaks, 7 Instrument correction, 8 Results tables, 9 Export. The build order differs from the wizard order, so wire placeholders early.

Size and strain methods: Scherrer, Monshi-Scherrer, Williamson-Hall (UDM, USDM, UDEDM), Size-Strain Plot, Halder-Wagner. Also strain, dislocation density, lattice parameters, texture coefficient, crystallinity index.

Thermal wizard order: 1 Upload and describe the run (atmosphere, heating rate, sample mass, sample type), 2 Clean data, 3 Baseline and steps (TGA mass loss steps with DTG, DSC peaks and glass transition), 4 Assign events, 5 Combined TGA-DSC interpretation and calcination suggestion, 6 Results and export. Calculations: onset, peak and endset temperatures, mass loss, residue, T5, T10 and T50, enthalpy, Tg and heat capacity change, polymer crystallinity, theoretical mass loss from formulas, and optional multi-rate activation energy (Kissinger, Flynn-Wall-Ozawa, Kissinger-Akahira-Sunose).

## 9. Out of scope

Full Rietveld structure refinement (atom positions, occupancies, displacement parameters; the basic refinement of cell, profile, preferred orientation and phase fractions approved by the owner in October 2026 is in scope), reliable identification of complex mixtures, any claim that a sample is or is not a single crystal, identifying evolved gases from TGA alone, claiming a suggested calcination temperature is optimal, bundling ICDD/JCPDS data, accounts, servers.

## 10. Working rules for Claude

- Work on one stage at a time. Do not start the next stage until I say so.
- Use one branch per stage named stage-N-short-name, commit in small steps, and open a pull request at the end.
- Before saying a stage is done, run lint, type check, tests and the production build, and report the real results, including failures.
- At the end of each stage update docs/PROGRESS.md with what was built, decisions made, known issues and the next stage.
- If a requirement is unclear or cannot be verified, ask me instead of guessing.
- Prefer simple, readable code over clever code. No dead code, no unused dependencies.

## 11. Starting a session

If I say "work", "continue", "next stage" or similar without naming a task: read docs/EXECUTION-PLAN.md, find
the first sub-stage in its status tracker that is not done, apply the guardrail block, and do that sub-stage
using its prompt in that file (and docs/STAGE-PROMPTS.md where it points there). Before finishing, set its
tracker row to done (or "blocked: reason") and update docs/PROGRESS.md in the same pull request.
