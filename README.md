# XRD Toolkit (working name)

A free, fast web app that guides early-career researchers through analysing materials
characterisation data, one step at a time. Four tools are planned: XRD, UV-Vis, FTIR and particle
size from SEM/TEM images. XRD comes first.

The XRD tool currently imports .xy, .xye, .dat, .txt, .csv, PANalytical .xrdml and Rigaku .ras
files (or pasted text), checks them, and plots and exports them. "Try with example data" loads
synthetic patterns that the site generates; they are not real measurements.

Everything runs in your browser. Uploaded files never leave your device, there are no accounts,
and the site uses no analytics or third-party resources.

The project plan and rules are in [CLAUDE.md](CLAUDE.md); progress is in
[docs/PROGRESS.md](docs/PROGRESS.md).

## Development

Requires Node.js 22 or newer.

```sh
npm install
npm run dev        # local dev server at http://localhost:5173
npm run lint       # ESLint and Prettier check (npm run format fixes formatting)
npm run typecheck  # TypeScript, strict mode
npm test           # Vitest unit tests
npm run build      # type check and production build into dist/
npm run size       # after a build: fails if the initial JavaScript is over 150 KB gzipped
npm run preview    # serve the production build locally
```

## Project structure

```
src/core/        pure TypeScript science code, no UI imports, fully unit tested
src/modules/     one folder per tool (xrd/, uvvis/, ftir/, particles/), each lazy-loaded
src/ui/          app shell, wizard, help popover, design tokens and themes
src/workers/     web workers for heavy computation
data/reference/  generated reference pattern JSON (from the Crystallography Open Database)
scripts/         build-time scripts (bundle-size check; later the reference library builder)
tests/           unit tests, synthetic fixtures (tests/fixtures/), real files (tests/fixtures-real/)
docs/            PROGRESS.md and method notes
```

## Continuous integration

Every pull request runs `.github/workflows/ci.yml`: lint, type check, tests, production build
and the bundle-size budget. These checks need no setup.

## Firebase Hosting setup (manual, one time)

The site is hosted on Firebase Hosting on the free Spark plan. Hosting only: no Cloud Functions or
other paid features. `.github/workflows/preview.yml` deploys every pull request to a temporary
preview URL and comments the link on the pull request. Until the steps below are done, that
workflow skips itself with a notice instead of failing.

1. **Create the Firebase project.** In the [Firebase console](https://console.firebase.google.com),
   add a project (Google Analytics is not needed; leave it off). Stay on the Spark plan. Open
   **Build → Hosting** and click **Get started** to enable Hosting. Note the **project ID** (shown
   in Project settings; it is not always the same as the display name).

2. **Put the project ID in the repo.** `.firebaserc` currently names the project `plot-bhai`. If
   your project ID is different, change it there and in `projectId:` in
   `.github/workflows/deploy.yml`, and commit the change.

3. **Create a service account for GitHub Actions.** These steps follow the deploy action's
   [service account guide](https://github.com/FirebaseExtended/action-hosting-deploy/blob/main/docs/service-account.md).
   1. Open the [Google Cloud service accounts page](https://console.cloud.google.com/iam-admin/serviceaccounts)
      and select the same project in the top bar.
   2. Click **Create service account** and name it, for example, `github-action-plot-bhai`.
   3. Grant these roles:
      - Firebase Authentication Admin (`roles/firebaseauth.admin`)
      - Firebase Hosting Admin (`roles/firebasehosting.admin`)
      - Cloud Run Viewer (`roles/run.viewer`)
      - API Keys Viewer (`roles/serviceusage.apiKeysViewer`)
   4. Finish, open the new service account, go to **Keys → Add key → Create new key → JSON**, and
      download the file. Treat it like a password and never commit it.

   Alternatively, `npx firebase-tools init hosting:github` creates the service account and secret
   for you. If you use it, decline when it offers to write workflow files (this repo already has
   them), and note it names the secret `FIREBASE_SERVICE_ACCOUNT_<PROJECT_ID>`. Either rename the
   secret reference in `preview.yml` to match, or create the secret by hand as in step 4.

4. **Add the key to GitHub as a secret.** In the GitHub repository go to
   **Settings → Secrets and variables → Actions → New repository secret**. Name it
   `FIREBASE_SERVICE_ACCOUNT` and paste the whole contents of the JSON key file as the value. Then
   delete the downloaded key file from your computer.

5. **Check it works.** Open or update a pull request. The **Preview deploy** workflow should
   comment a preview URL that expires after 7 days. After a merge to `main`, the **Deploy**
   workflow (`.github/workflows/deploy.yml`) builds and publishes the live site by itself, using
   the same secret. Until the secret exists it skips itself with a notice.

To publish the live site by hand instead (for example the first time), run this from a clean
checkout of `main`:

```sh
npm ci && npm run build
npx firebase-tools login
npx firebase-tools deploy --only hosting
```

`firebase.json` serves `dist/` with long-lived caching for hashed files in `/assets/`, `no-cache`
for everything else (so new releases show up immediately), and security headers including a strict
Content Security Policy (scripts, styles and data from this site only; no inline scripts).

## Offline use and checks

`public/sw.js` is a small service worker (no library). After a tool has been opened once, the
pages and files it used are kept in the browser cache, so that tool works offline. It only caches
files from this site. To remove it, clear the site data in your browser.

`npm run audit` (after `npm run build`) opens every tool at 360, 768, 1280 and 1920 px and reports
sideways scrolling, touch targets under 44 px and controls without a name.
