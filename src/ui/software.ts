/** Version of this release, as in package.json and CITATION.cff. */
export const VERSION = __VERSION__;

/**
 * Zenodo concept DOI: it always resolves to the latest archived version (v1.0.0 is
 * 10.5281/zenodo.24222106). Checked on zenodo.org, November 2026.
 */
export const DOI = '10.5281/zenodo.24222105';

/** How the software is named in methods texts and analysis records, with its version and build. */
export const SOFTWARE = `Plot Bhai ${VERSION} (free, runs in the browser; build ${__BUILD__}; doi:${DOI})`;
