/**
 * Shared filtering rules for the file-explorer tree listing (`/api/files?type=list`)
 * and the @-mention file index fallback (`/api/file-index` non-git walk).
 *
 * The pi TUI uses `fd`, which honors `.gitignore` in git repositories. To match
 * that behavior, the tree listing asks git for the ignored immediate children
 * of a directory and filters those out. Outside git (or when git is
 * unavailable) we fall back to a static list of well-known build/dependency
 * directories. `vendor` is intentionally NOT in that list: in Go (and some
 * PHP/Ruby) projects it is committed source the user wants to browse, so
 * hiding it unconditionally was a regression.
 */

/**
 * Names hidden only in the non-git fallback path. Kept conservative: only
 * well-known dependency / build-output directories that are virtually never
 * source the user wants to browse.
 */
export const NON_GIT_IGNORED_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache",
  "target", ".DS_Store",
]);

/**
 * Names hidden even inside a git repository. `.gitignore` does not cover these
 * (`.git` is the repository itself; `.DS_Store` is frequently untracked but
 * not always ignored), so they are force-hidden regardless of git state.
 */
export const ALWAYS_HIDDEN_NAMES = new Set([
  ".git", ".DS_Store",
]);

export const IGNORED_SUFFIXES = [".pyc"];

/**
 * Select the visible entry names for a single directory listing.
 *
 * `ignoredImmediateNames` is the set returned by
 * `listIgnoredImmediateNames(dir)` (i.e. gitignored direct children), or
 * `null` when the directory is not inside a git repository. Passing `null`
 * switches to the static non-git fallback list.
 */
export function selectVisibleTreeNames(
  names: string[],
  ignoredImmediateNames: Set<string> | null,
): string[] {
  const hiddenNames = ignoredImmediateNames === null
    ? NON_GIT_IGNORED_NAMES
    : ALWAYS_HIDDEN_NAMES;
  const ignored = ignoredImmediateNames ?? new Set<string>();

  const result: string[] = [];
  for (const name of names) {
    if (hiddenNames.has(name)) continue;
    if (ignored.has(name)) continue;
    if (IGNORED_SUFFIXES.some((suffix) => name.endsWith(suffix))) continue;
    result.push(name);
  }
  return result;
}
