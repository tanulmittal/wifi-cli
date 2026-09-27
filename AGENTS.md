# Project instructions

`openwifi` is a small TypeScript CLI for Linux and macOS. Keep changes focused and use built-in OS WiFi tools; do not add storage for passwords.

- Public distribution is `npm install -g github:tanulmittal/wifi-cli --install-links`. Keep the compiled `dist/` files in Git and executable `dist/openwifi.cjs` for Git installs. The executable bundles JavaScript dependencies; runtime must not fetch packages.
- Run `npm ci`, `npm run bundle`, and `npm test` after code changes. Use mocked OS commands for network-changing tests. Do not add npm `build` or lifecycle scripts: GitHub installs must use the committed bundle without Git dependency preparation.
- Never log or print WiFi passwords. Do not mutate saved networks or radio power during routine smoke tests.
- When a platform cannot safely perform an operation, return a clear error before changing state.
