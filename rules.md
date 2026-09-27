# Engineering rules

- Keep the CLI small and bundle JavaScript dependencies into the executable committed under `dist/` for direct GitHub installs.
- Invoke system tools with argument arrays, not shell interpolation. Never print or persist WiFi passwords outside system stores.
- Mock OS commands in tests. Do not run connection-changing smoke tests on a live host.
- Reject unsupported writes before invoking another network tool. Do not automatically install, start, or switch a host's network manager.
- Run `npm ci`, `npm run build`, and `npm test` after code changes.
