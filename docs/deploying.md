# Deploying

How the site is hosted and how to set up deployment for a fork or a new Firebase project.

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
