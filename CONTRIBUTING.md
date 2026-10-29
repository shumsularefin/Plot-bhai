# Contributing

Bug reports and suggestions are welcome as GitHub issues. For a scientific error, please include
the input file (or a small synthetic one), the settings used, the value you expected and the source
of that value (paper, standard or textbook with page).

Pull requests must pass `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`.
Science code lives in `src/core/` with a doc comment giving the equation, symbols and units, and a
test on synthetic data with a known answer. Never add JCPDS/ICDD data, and never add a reference
value you cannot cite. The project rules are in CLAUDE.md.
