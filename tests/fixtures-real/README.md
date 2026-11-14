# Real instrument files

Real XRD files exported from instruments. `tests/realFiles.test.ts` checks that every file here
loads without an error, and `tests/xrd-packed-formats.test.ts` compares every point with two
independent extractions kept in `tests/real-references/`. `tests/validation-nist-srm.test.ts`
refines the two NIST patterns and compares the lattice parameter with NIST's. Only add files that may be shared
publicly, with their source and licence below, because this repository is public.

| File                         | Points | Source                                                                                                                                                                       | Licence    |
| ---------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `rigaku_powder.rasx`         | 2,726  | FAIRmat readers-xrd, `tests/data/TwoTheta_scan_powder.rasx`, copied via the geddes test corpus (`tests/data/formats/real/`, commit f5660e8611b8333336f696d2d5a46eb22a6e2cae) | Apache-2.0 |
| `rigaku_zno_counts.rasx`     | 7,001  | FAIRmat readers-xrd, `tests/data/ZnO-ALD-training_001_1_0-000_0-000.rasx`, via geddes as above                                                                               | Apache-2.0 |
| `bruker_absorber.brml`       | 2,001  | FAIRmat readers-xrd, `tests/data/23-012-AG_2thomegascan_long.brml`, via geddes as above                                                                                      | Apache-2.0 |
| `bruker_locked_coupled.brml` | 2,443  | cheminfo/xrd-analysis, `src/from/__tests__/data/test.brml` (commit ccab9401e0e5da09e25111c159aeeb874e337113)                                                                 | MIT        |
| `bruker4_v5converter.raw`    | 4,059  | geddes, `tests/data/bruker_raw/bruker4_v5converter.raw` (commit above)                                                                                                       | MIT        |
| `bruker4_diffrac_eva.raw`    | 7,134  | geddes, `tests/data/bruker_raw/bruker4_diffrac_eva.raw`; its intensities were scrambled upstream, so it checks byte decoding (8-byte records), not physics                   | MIT        |

| `nist_srm660c_lab6.cif` | 5,332 | NIST data release of SRM 660c (LaB₆), file `660_cert_cif_mosaic_consensus_200a.cif` of `srm_660c_cifs_20201029_081700.zip` (zip SHA-256 92034d06…2c42), supplied by the owner | US Government work (NIST), public domain in the US |
| `nist_srm640f_si.cif` | 28,099 | NIST data release of SRM 640f (Si), file `cif_gen_20180612_073551.10.0.tan.cif` of `srm640f_cifs_20200601a.zip` (zip SHA-256 f135999e…0b96), supplied by the owner | US Government work (NIST), public domain in the US |

SHA-256 hashes of the first five files match geddes's `tests/data/formats/manifest.json`. The
licence texts are in `tests/real-references/`. geddes: https://github.com/jcwang587/geddes;
FAIRmat readers-xrd: https://github.com/FAIRmat-NFDI/readers-xrd; cheminfo:
https://github.com/cheminfo/xrd-analysis.

The NIST files are unchanged (SHA-256 2644f5e4…7dfc for 660c, fe9d7fbb…37d7 for 640f). Each holds the
measured pattern with NIST's least-squares weights, a pattern calculated by NIST, and the lattice
parameter NIST refined from that pattern; the certification is described in D. R. Black et al.,
Powder Diffraction 35 (2020) 17–22, doi 10.1017/S0885715620000068 (660c).
