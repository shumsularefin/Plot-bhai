# Polymer library

COD already holds cellulose Iα and Iβ, α- and β-chitin, V-amylose and isotactic polypropylene;
users find those through the COD search, so they are not bundled. The library adds 14 crystalline
polymer phases that COD does not hold. Coordinates were transcribed by hand from the papers in
docs/papers/ and are cited in each CIF header in `data/polymers/`. `npm run build:polymers`
turns them into `data/reference/polymers.json` and the app index. Each phase is labelled with its
paper and DOI, has no COD number, and is flagged for the owner's verification.

## Checks made on every transcription

1. Bond lengths and angles after applying the full symmetry (gemmi), compared with the paper.
2. Where the paper prints calculated structure factors, our |F| against its Fcalc (R value).
3. Line positions recomputed independently with pymatgen: all 14 phases agree (max Δ 0.000°).

| Phase                              | Paper                      | Space group | Result                                                                                                                                          |
| ---------------------------------- | -------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Cellulose II                       | Langan 2001                | P2₁         | bonds as paper                                                                                                                                  |
| Cellulose III_I                    | Wada 2004                  | P2₁         | bonds as paper; no displacement parameters given                                                                                                |
| A-amylose                          | Popov 2009                 | B2          | bonds as paper                                                                                                                                  |
| α-PLLA                             | Wasanasuk 2011             | P2₁         | screw axis chosen as −x+½, y+½, −z+½: the only setting that keeps the chains apart and gives the near-P2₁2₁2₁ pseudo-symmetry the paper reports |
| PEO                                | Takahashi & Tadokoro 1973  | P2₁/a       | bonds as paper                                                                                                                                  |
| PHB                                | Yokouchi 1973              | P2₁2₁2₁     | bonds as paper                                                                                                                                  |
| Nylon 6 α                          | Holmes, Bunn & Smith 1955  | P2₁         | early geometry (some bonds 1.15–1.19 Å); intensities approximate                                                                                |
| PET                                | Daubeny, Bunn & Brown 1954 | P1̄          | bonds as paper                                                                                                                                  |
| Poly-α-L-guluronic acid (alginate) | Atkins 1973                | P2₁2₁2₁     | R 0.047 against Fcalc; C6 y read as 0.105 from a damaged digit                                                                                  |
| PCL                                | Chatani 1970               | P2₁2₁2₁     | R 0.08 against Fcalc                                                                                                                            |
| PVDF α                             | Hasegawa 1972              | P2₁/c       | R 0.157 against summed Fcalc                                                                                                                    |
| PVDF β                             | Hasegawa 1972              | Cm2m        | statistical disorder modelled as half-occupied off-mirror atoms                                                                                 |
| PVA                                | Bunn 1948                  | P2₁/m       | O half-occupied at two sites, as in the paper                                                                                                   |

## Not included

- Silk fibroin (Takahashi 1999): our reconstruction could not reproduce the paper's Fcalc (best R
  0.32), so it is left out rather than shipped unverified.
- French 2014 supporting information: its cellulose Iα, Iβ, II and III_I blocks repeat structures already in COD or in this library. Its cellulose III_II block (adapted from Wada 2009) lists both chains and also the P2₁ operator, so atoms land 0.33 Å apart; it cannot be used as given. TODO: the original Wada 2009 coordinates (Biomacromolecules 10:302, 10.1021/bm8010227).
- Polyethylene (Phillips & Hanna 2005): a simulation paper, not a structure determination.
- A-starch (Imberty 1988): superseded by Popov 2009.
- PolySac3DB: the database site could not be reached from the build environment.
- PMMA, gelatin, PVP and other amorphous polymers have no crystal structure; their broad humps
  cannot be matched to a reference pattern.
