# Third-party software

Runtime libraries bundled into the site (all self-hosted):

| Package  | Licence | Project                            |
| -------- | ------- | ---------------------------------- |
| preact   | MIT     | https://github.com/preactjs/preact |
| d3-array | ISC     | https://github.com/d3/d3-array     |
| tiff     | MIT     | https://github.com/image-js/tiff   |

The full licence texts are in each package under `node_modules/<package>/LICENSE` after
`npm install`. Development tools (Vite, TypeScript, Vitest, ESLint, Prettier and others listed in
package.json) are not shipped to users. The site uses the system font stack; no fonts are bundled.
