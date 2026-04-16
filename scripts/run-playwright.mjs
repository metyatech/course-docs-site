import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

const run = () =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [playwrightCli, ...args], {
      stdio: "inherit",
      cwd: projectRoot,
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });

const exitCode = await run();
process.exit(exitCode);
