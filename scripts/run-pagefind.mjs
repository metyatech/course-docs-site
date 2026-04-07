import { spawnSync } from "node:child_process";
import path from "node:path";
import { resolveNextDistDirPath } from "./next-dist-dir.mjs";

const projectRoot = process.cwd();
const nextDistDirPath = resolveNextDistDirPath({ projectRoot, env: process.env });
const sitePath = path.join(nextDistDirPath, "server", "app");

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status}`);
  }
};

if (process.platform === "win32") {
  run("cmd.exe", [
    "/d",
    "/s",
    "/c",
    "npm",
    "exec",
    "--",
    "pagefind",
    "--site",
    sitePath,
    "--output-path",
    "public/_pagefind",
  ]);
} else {
  run("npm", ["exec", "--", "pagefind", "--site", sitePath, "--output-path", "public/_pagefind"]);
}
