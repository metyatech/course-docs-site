import { spawn } from "node:child_process";
import { normalizeNpmPathEnv } from "./verify-precommit-path.mjs";

const npmExecPath = process.env.npm_execpath;
if (!npmExecPath) {
  throw new Error("npm_execpath is required to run the pre-commit verification chain");
}

const env = normalizeNpmPathEnv(process.env);
const steps = [
  ["run", "platform:verify"],
  ["run", "lint"],
  ["test"],
  ["run", "audit:dependencies"],
];

for (const args of steps) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmExecPath, ...args], {
      stdio: "inherit",
      env,
      windowsHide: true,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${args.join(" ")} exited with code ${code}`));
    });
  });
}
