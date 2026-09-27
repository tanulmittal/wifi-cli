import fs from "node:fs";
if (fs.existsSync(new URL("../dist/cli.js", import.meta.url))) process.exit(0);
console.log("dist missing, building...");
process.exit(1);
