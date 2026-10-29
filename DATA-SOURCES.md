# Data sources and licences

The code is MIT licensed (LICENSE). The data shipped with the site comes from these sources and
keeps their terms. Every value that was transcribed by hand is flagged for the owner's verification
in its file.

| Data                                                                    | Source                                                                                                                    | Terms                                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Reference patterns fetched at run time                                  | Crystallography Open Database (COD), via the read-only lookup Worker (`worker/`)                                          | COD data are public domain (CC0). Cite the COD entry and its original paper.               |
| Polymer library (`data/polymers/*.cif`, `data/reference/polymers.json`) | Atomic coordinates hand-transcribed from the published papers cited in each CIF header; checks in docs/polymer-library.md | Facts (coordinates) from the cited papers; cite the original paper when you use a pattern. |
| X-ray scattering factors (`data/reference/scattering-factors.json`)     | International Tables for Crystallography Vol. C (1992), coefficients taken from the gemmi source file `it92.hpp`          | Tabulated physical constants; gemmi itself is MPL-2.0, credited here.                      |
| FTIR group table (`data/ftir/`)                                         | As cited in `data/ftir/groups.json`                                                                                       | CC BY 4.0 (attribution in the file).                                                       |
| Atomic weights (`data/thermal/`)                                        | CIAAW abridged standard atomic weights 2024                                                                               | Cited in the file.                                                                         |
| Thermal event rule table (`data/thermal/`)                              | Sources cited per row in the file                                                                                         | Ranges are suggestions, flagged for verification.                                          |
| Example data ("Try with example data")                                  | Generated synthetically by the site                                                                                       | Not real measurements.                                                                     |

No JCPDS/ICDD data are bundled or fetched. A JCPDS number a user types is printed as entered and
is never verified.

## Privacy

Uploaded files never leave the browser. The only network requests are:

- the COD lookup (element symbols, formulas or COD numbers);
- the feedback Worker (a random browser ID, the analysis section name, a validation verdict and an
  optional comment; IP addresses and browser IDs are stored only as salted hashes, comments are
  published only after the owner approves them).

There are no accounts, cookies for tracking, analytics, third-party CDNs or web fonts.
