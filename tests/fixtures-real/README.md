# Real instrument files

Real XRD files exported from instruments. `tests/realFiles.test.ts` checks that every file here
loads without an error, and `tests/xrd-packed-formats.test.ts` compares every point with two
independent extractions kept in `tests/real-references/`. Only add files that may be shared
publicly, with their source and licence below, because this repository is public.

| File                         | Points | Source                                                                                                                                                                       | Licence    |
| ---------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `rigaku_powder.rasx`         | 2,726  | FAIRmat readers-xrd, `tests/data/TwoTheta_scan_powder.rasx`, copied via the geddes test corpus (`tests/data/formats/real/`, commit f5660e8611b8333336f696d2d5a46eb22a6e2cae) | Apache-2.0 |
| `rigaku_zno_counts.rasx`     | 7,001  | FAIRmat readers-xrd, `tests/data/ZnO-ALD-training_001_1_0-000_0-000.rasx`, via geddes as above                                                                               | Apache-2.0 |
| `bruker_absorber.brml`       | 2,001  | FAIRmat readers-xrd, `tests/data/23-012-AG_2thomegascan_long.brml`, via geddes as above                                                                                      | Apache-2.0 |
| `bruker_locked_coupled.brml` | 2,443  | cheminfo/xrd-analysis, `src/from/__tests__/data/test.brml` (commit ccab9401e0e5da09e25111c159aeeb874e337113)                                                                 | MIT        |
| `bruker4_v5converter.raw`    | 4,059  | geddes, `tests/data/bruker_raw/bruker4_v5converter.raw` (commit above)                                                                                                       | MIT        |
| `bruker4_diffrac_eva.raw`    | 7,134  | geddes, `tests/data/bruker_raw/bruker4_diffrac_eva.raw`; its intensities were scrambled upstream, so it checks byte decoding (8-byte records), not physics                   | MIT        |

SHA-256 hashes of the first five files match geddes's `tests/data/formats/manifest.json`. The
licence texts are in `tests/real-references/`. geddes: https://github.com/jcwang587/geddes;
FAIRmat readers-xrd: https://github.com/FAIRmat-NFDI/readers-xrd; cheminfo:
https://github.com/cheminfo/xrd-analysis.
