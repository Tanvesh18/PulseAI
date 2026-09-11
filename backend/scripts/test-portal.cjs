const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const dotenv = require("dotenv");
const settings = fs.existsSync(".env.portal-test")
  ? dotenv.parse(fs.readFileSync(".env.portal-test"))
  : {};
const url = process.env.TEST_DATABASE_URL || settings.DATABASE_URL;
if (!url)
  throw new Error(
    "Configure TEST_DATABASE_URL or .env.portal-test for an isolated test branch.",
  );
const result = spawnSync(
  process.execPath,
  [
    "--experimental-vm-modules",
    require.resolve("jest/bin/jest"),
    "--runInBand",
    "--testRegex=portal.integration.ts$",
  ],
  { stdio: "inherit", env: { ...process.env, TEST_DATABASE_URL: url } },
);
process.exitCode = result.status ?? 1;
