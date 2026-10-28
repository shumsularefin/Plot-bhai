# Validation, comments and counters: the feedback service

The tools are an early testing version, so every analysis section has a highlighted
**Validate** button. Its pop-up asks whether the result worked and takes an optional comment.
The home page shows how many visits, finished analyses and validations there have been, and the
comments the owner has approved. A small Cloudflare Worker with a D1 database (`worker-feedback/`)
keeps these, on the Cloudflare free plan.

## What is sent and kept

- **Sent:** a random ID made for the browser, the name of the analysis section (for example
  "XRD analysis"), the verdict ("It worked" or "Something is wrong") and the comment. Data files
  and results are never sent.
- **Kept:** the counters, the analyses (random ID, day, section, hashed browser ID) and the
  validations (time, section, verdict, comment, review status). IP addresses and browser IDs are
  stored only as HMAC hashes with a secret; the IP hash also includes the day, and the daily
  limit rows are deleted after two days.

## Rules (in `worker-feedback/feedback.js`)

- **No validation without an analysis.** Reaching the last step of a wizard records a finished
  analysis and gets a proof (an HMAC of the analysis ID, browser ID and section). `/validate`
  needs that proof, from the same browser and section, made today or yesterday, and accepts one
  validation per analysis.
- **Daily limits** (`LIMITS`): 30 analyses and 5 validations per browser, 100 analyses and 20
  validations per IP address, and at most 20 browsers counted as visits per IP address. A visit
  is counted once per browser per day.
- **Comments** are at most 1000 characters and stay **pending** until the owner approves them.
  A validation without a comment needs no approval.
- Writes are accepted only from the live site, its Firebase preview channels and `localhost`.
- Without its secrets the service answers 503, and the site hides the counters and says that
  validation is unavailable. Everything else works without the service.

## One-time setup (the repository owner)

The account ID and API token are the ones from the COD lookup (docs/cod-lookup.md), with one
change:

1. **D1 permission.** In Cloudflare: profile icon → _My Profile_ → _API Tokens_ → edit the
   token used for `CLOUDFLARE_API_TOKEN` → add the permission _Account_ · _D1_ · _Edit_ → save.
2. **Two new GitHub secrets** (_Settings_ → _Secrets and variables_ → _Actions_): long random
   strings, for example from `openssl rand -hex 32`.
   - `FEEDBACK_PROOF_SECRET`: signs the proofs and salts the hashes. Changing it later makes
     open proofs invalid and starts the hashes afresh.
   - `FEEDBACK_ADMIN_TOKEN`: your password for approving comments. Keep a copy.
3. Run _Actions_ → **Feedback worker** → _Run workflow_. It creates the database
   `plot-bhai-feedback` if it does not exist, creates the tables, deploys the Worker and sets
   its secrets. It runs again by itself whenever `worker-feedback/` changes on `main`.

The site expects the address `https://plot-bhai-feedback.plot-bhai.workers.dev` (the same
`workers.dev` subdomain as the COD lookup). If yours differs, change `FEEDBACK_API` in
`src/ui/feedback/client.ts` and `connect-src` in `firebase.json` in one commit.

## Approving comments

```sh
API=https://plot-bhai-feedback.plot-bhai.workers.dev
TOKEN=...   # FEEDBACK_ADMIN_TOKEN

# List pending comments (newest first)
curl -s -H "Authorization: Bearer $TOKEN" "$API/admin/pending"

# Publish comment 12, or reject comment 13
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"id":12}' "$API/admin/approve"
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"id":13}' "$API/admin/reject"
```

## Checking it

`GET $API/stats` returns the three counters, and `GET $API/comments` the approved comments.
`tests/feedback-worker.test.ts` tests the rules against an in-memory SQLite database with the
same schema.
