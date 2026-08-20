import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function loadSubject() {
  return import("./git-ignore.ts");
}

test("parseIgnoredImmediateNames strips trailing slashes from directories", async () => {
  const { parseIgnoredImmediateNames } = await loadSubject();
  const stdout = "node_modules/\0.env\0build/\0";
  const result = parseIgnoredImmediateNames(stdout);
  assert.deepEqual([...result].sort(), [".env", "build", "node_modules"]);
});

test("parseIgnoredImmediateNames drops deeper descendants", async () => {
  const { parseIgnoredImmediateNames } = await loadSubject();
  // `--directory` only emits immediate children, but be defensive: any entry
  // containing a `/` (a deeper path) must not be treated as an immediate name.
  const stdout = "node_modules/\0src/foo/\0dist/debug.log\0";
  const result = parseIgnoredImmediateNames(stdout);
  assert.deepEqual([...result].sort(), ["node_modules"]);
});

test("parseIgnoredImmediateNames handles empty output", async () => {
  const { parseIgnoredImmediateNames } = await loadSubject();
  assert.equal(parseIgnoredImmediateNames("").size, 0);
  assert.equal(parseIgnoredImmediateNames("\0\0").size, 0);
});

test("listIgnoredImmediateNames returns null outside a git repo", async (t) => {
  const { listIgnoredImmediateNames, __resetGitIgnoreCacheForTests } = await loadSubject();
  __resetGitIgnoreCacheForTests();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-git-ignore-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = await listIgnoredImmediateNames(root);
  assert.equal(result, null);
});

test("listIgnoredImmediateNames honors .gitignore inside a git repo", async (t) => {
  const { listIgnoredImmediateNames, __resetGitIgnoreCacheForTests } = await loadSubject();
  __resetGitIgnoreCacheForTests();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-git-ignore-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.mkdirSync(path.join(root, "node_modules"));
  fs.mkdirSync(path.join(root, "vendor"));
  fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n.env\n");
  fs.writeFileSync(path.join(root, ".env"), "SECRET=1\n");
  fs.writeFileSync(path.join(root, "README.md"), "# hi\n");
  // `git init` is enough — `git ls-files --ignored` does not require commits.
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await execFileAsync("git", ["add", "vendor", "README.md"], { cwd: root });

  const result = await listIgnoredImmediateNames(root);
  assert.notEqual(result, null);
  // `vendor/` is committed (not gitignored) → must NOT be in the ignored set.
  // `node_modules/` and `.env` ARE gitignored → must be present.
  assert.ok(result.has("node_modules"), "node_modules should be ignored");
  assert.ok(result.has(".env"), ".env should be ignored");
  assert.equal(result.has("vendor"), false, "committed vendor/ must not be ignored");
  assert.equal(result.has("README.md"), false, "tracked README.md must not be ignored");
  assert.equal(result.has(".git"), false, ".git is not returned by ls-files --ignored");
});

test("listIgnoredImmediateNames caches results and dedups concurrent calls", async (t) => {
  const { listIgnoredImmediateNames, __resetGitIgnoreCacheForTests } = await loadSubject();
  __resetGitIgnoreCacheForTests();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-git-ignore-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n");
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await execFileAsync("git", ["add", ".gitignore"], { cwd: root });

  // Fire two concurrent calls for the same dir — they must share one git spawn.
  const [a, b] = await Promise.all([
    listIgnoredImmediateNames(root),
    listIgnoredImmediateNames(root),
  ]);
  assert.equal(a, b, "concurrent calls return the same cached object");
  assert.ok(a?.has("node_modules"));

  // A third call returns the cached object without re-spawning git.
  const c = await listIgnoredImmediateNames(root);
  assert.equal(c, a, "subsequent call returns the cached object");
});
