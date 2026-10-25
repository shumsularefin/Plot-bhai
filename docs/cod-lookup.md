# Online COD search: the lookup service

The XRD tool can search the whole Crystallography Open Database (COD) from a periodic table and
load any entry's CIF. Browsers cannot ask COD directly (COD sends no CORS header), so a small
Cloudflare Worker in `worker/` does it:

- `GET /search?elements=Bi,V,O&only=1` and `GET /search?formula=Bi O4 V` return a short list
  (COD ID, formula, name, mineral, space group, cell, year, journal). Searches with more than
  300 results are refused with their count, so the user narrows them.
- `GET /cif/1234567` returns one CIF.

It answers nothing else, checks every input before contacting COD, gives the CORS header only
to the live site, its preview channels and `localhost`, and caches answers for a day. Only
element symbols, formulas and COD numbers reach it; users' data files never leave their browser.
It runs on the Cloudflare Workers free plan (100,000 requests a day at the time of writing).

## One-time setup (the repository owner)

1. **workers.dev subdomain.** In the Cloudflare dashboard open _Workers & Pages_. If it asks you
   to choose a `workers.dev` subdomain, choose one (any name).
2. **Account ID.** On the same page (or the dashboard home, right-hand column) copy the
   _Account ID_.
3. **API token.** Click your profile icon → _My Profile_ → _API Tokens_ → _Create Token_ → use
   the template **Edit Cloudflare Workers** → _Continue to summary_ → _Create Token_. Copy the
   token (it is shown once).
4. **GitHub secrets.** In the repository on GitHub: _Settings_ → _Secrets and variables_ →
   _Actions_ → _New repository secret_, twice:
   - `CLOUDFLARE_ACCOUNT_ID` = the account ID
   - `CLOUDFLARE_API_TOKEN` = the token

After that, `.github/workflows/worker.yml` deploys the Worker whenever `worker/` changes on
`main` (or when run by hand from the _Actions_ tab). Its log ends with the Worker's address,
`https://plot-bhai-cod.<your-subdomain>.workers.dev`.

## Connecting the site

The address goes in two places, in one commit:

- `COD_API` in `src/modules/xrd/codLookup.ts`;
- `connect-src` of the Content-Security-Policy in `firebase.json`.

Until then the online search is hidden and the step offers CIF upload and COD links only.

## Checking it

Open `https://plot-bhai-cod.<your-subdomain>.workers.dev/search?elements=Bi,V,O&only=1` in a
browser: it should show JSON with about two dozen entries. `tests/cod-lookup.test.ts` tests the
handler with COD stubbed; it was also run against the live COD in `wrangler dev`.
