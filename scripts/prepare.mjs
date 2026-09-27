import fs from 'node:fs';
if (!fs.existsSync(new URL('../dist/cli.js', import.meta.url))) {
  console.error('openwifi is missing dist/cli.js. Clone the repository and run npm ci && npm run build.');
  process.exitCode = 1;
}
