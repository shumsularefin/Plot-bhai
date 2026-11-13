# Releasing a version and getting a DOI

A paper should cite one fixed version of the software. This is how a version is cut and archived.

## 1. Cut the version

1. Choose the number (semantic versioning: 0.2.0 → 0.2.1 for fixes, 0.3.0 for new features).
2. Set it in two places: `version` in `package.json` and `version` plus `date-released` in
   `CITATION.cff`. The site reads the number from `package.json` at build time and prints it in the
   footer, in every methods text and in every analysis record.
3. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run size` and
   `npm run e2e`.
4. Merge to `main`, then on GitHub: Releases → Draft a new release → tag `v0.2.0` → Publish.

## 2. Archive it on Zenodo (once, by the owner)

Zenodo gives each GitHub release a permanent DOI. It needs the repository owner's own login, so
it cannot be done from a coding session.

1. Sign in at https://zenodo.org with the GitHub account that owns the repository.
2. Open the GitHub page of the Zenodo account settings and switch the repository on.
3. Publish a GitHub release (step 1.4). Zenodo archives it and shows two DOIs: one for this
   version and one "concept" DOI that always points to the latest version.
4. Put the concept DOI in `CITATION.cff` (the `doi:` line that is marked TODO there) and in the
   README, and commit.

Until that is done the site has a version number but no DOI, and CITATION.cff says so.

## 3. What a user cites

The methods text of every tool names "Plot Bhai" with the version and the build (commit and
date). With a DOI, add it to the reference list as CITATION.cff describes.
