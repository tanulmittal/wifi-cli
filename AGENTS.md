# Project instructions

`openwifi` is a small TypeScript CLI for Linux and macOS. Keep changes focused and use built-in OS WiFi tools; do not add storage for passwords.

- Public distribution is `npm install -g github:tanulmittal/wifi-cli`. Keep the compiled `dist/` files in Git and executable `dist/cli.js` for Git installs.
- Run `npm ci`, `npm run build`, and `npm test` after code changes. Use mocked OS commands for network-changing tests.
- Never log or print WiFi passwords. Do not mutate saved networks or radio power during routine smoke tests.
- When a platform cannot safely perform an operation, return a clear error before changing state.
