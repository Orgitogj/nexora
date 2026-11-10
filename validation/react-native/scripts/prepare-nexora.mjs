import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(fixtureDirectory, "..", "..");
const archive = resolve(fixtureDirectory, "nexora-0.1.0.tgz");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(args, cwd) {
  execFileSync(npm, args, {
    cwd,
    shell: process.platform === "win32",
    stdio: "inherit",
  });
}

run(["run", "build"], repositoryRoot);
run(["pack", "--pack-destination", fixtureDirectory], repositoryRoot);
if (!existsSync(archive)) throw new Error(`Expected package archive was not created: ${archive}`);
run(["install"], fixtureDirectory);
