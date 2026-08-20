import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./file-tree-listing.ts");
}

test("non-git fallback: hides well-known dependency/build dirs but shows vendor", async () => {
  const { selectVisibleTreeNames, NON_GIT_IGNORED_NAMES } = await loadSubject();
  // Sanity: vendor must NOT be in the static fallback list.
  assert.equal(NON_GIT_IGNORED_NAMES.has("vendor"), false);

  const names = ["src", "vendor", "node_modules", "dist", ".git", "README.md", "app.pyc"];
  const visible = new Set(selectVisibleTreeNames(names, null));
  assert.ok(visible.has("src"));
  assert.ok(visible.has("vendor"), "vendor must be visible in the non-git fallback");
  assert.ok(visible.has("README.md"));
  assert.equal(visible.has("node_modules"), false);
  assert.equal(visible.has("dist"), false);
  assert.equal(visible.has(".git"), false);
  assert.equal(visible.has("app.pyc"), false);
});

test("git repo: hides gitignored entries but shows tracked vendor", async () => {
  const { selectVisibleTreeNames } = await loadSubject();
  const ignored = new Set(["node_modules", ".env", "build"]);
  const names = ["src", "vendor", "node_modules", ".env", "build", ".git", ".DS_Store", "README.md"];
  const visible = new Set(selectVisibleTreeNames(names, ignored));
  assert.ok(visible.has("src"));
  assert.ok(visible.has("vendor"), "tracked vendor/ must be visible inside a git repo");
  assert.ok(visible.has("README.md"));
  assert.equal(visible.has("node_modules"), false, "gitignored node_modules must be hidden");
  assert.equal(visible.has(".env"), false, "gitignored .env must be hidden");
  assert.equal(visible.has("build"), false, "gitignored build must be hidden");
  assert.equal(visible.has(".git"), false, ".git is always hidden");
  assert.equal(visible.has(".DS_Store"), false, ".DS_Store is always hidden");
});

test("git repo: still applies .pyc suffix filter on top of gitignore", async () => {
  const { selectVisibleTreeNames } = await loadSubject();
  const ignored = new Set(["node_modules"]);
  const names = ["main.py", "cache.pyc", "node_modules"];
  const visible = new Set(selectVisibleTreeNames(names, ignored));
  assert.ok(visible.has("main.py"));
  assert.equal(visible.has("cache.pyc"), false);
  assert.equal(visible.has("node_modules"), false);
});

test("non-git fallback: empty input returns empty", async () => {
  const { selectVisibleTreeNames } = await loadSubject();
  assert.deepEqual(selectVisibleTreeNames([], null), []);
});

test("git repo: empty ignored set still hides always-hidden names", async () => {
  const { selectVisibleTreeNames } = await loadSubject();
  const visible = new Set(selectVisibleTreeNames([".git", ".DS_Store", "src"], new Set()));
  assert.ok(visible.has("src"));
  assert.equal(visible.has(".git"), false);
  assert.equal(visible.has(".DS_Store"), false);
});
