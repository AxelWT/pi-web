import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// The file-explorer tree lists a directory on every expansion and on every
// refresh of already-open folders, so this runs far more often than git status
// or the @-mention index. A hanging/slow git must not freeze the UI, so the
// timeout is tighter than the 10s used elsewhere and results are cached briefly.
const GIT_IGNORE_TIMEOUT_MS = 4_000;
const GIT_IGNORE_MAX_BUFFER = 8 * 1024 * 1024;
const CACHE_TTL_MS = 5_000;
const CACHE_MAX_ENTRIES = 100;

declare global {
  var __piGitIgnoreCache: Map<string, { value: Set<string> | null; expiresAt: number }> | undefined;
  var __piGitIgnoreInFlight: Map<string, Promise<Set<string> | null>> | undefined;
}

function getCache(): Map<string, { value: Set<string> | null; expiresAt: number }> {
  if (!globalThis.__piGitIgnoreCache) globalThis.__piGitIgnoreCache = new Map();
  return globalThis.__piGitIgnoreCache;
}

function getInFlight(): Map<string, Promise<Set<string> | null>> {
  if (!globalThis.__piGitIgnoreInFlight) globalThis.__piGitIgnoreInFlight = new Map();
  return globalThis.__piGitIgnoreInFlight;
}

/**
 * Parse the NUL-delimited stdout of
 *   git ls-files --others --ignored --exclude-standard --directory -z
 * into the set of *immediate* ignored entry names (relative to the directory
 * the command was run in).
 *
 * `--directory` collapses an ignored directory into a single trailing-slash
 * entry (e.g. `node_modules/`) instead of enumerating its contents, so the
 * output stays small even for huge dependency trees. We strip that trailing
 * slash. Entries containing a `/` are deeper descendants and are dropped —
 * only direct children of the queried directory are returned, since that is
 * what a single readdir-level listing needs.
 */
export function parseIgnoredImmediateNames(stdout: string): Set<string> {
  const result = new Set<string>();
  for (const raw of stdout.split("\0")) {
    if (!raw) continue;
    const name = raw.endsWith("/") ? raw.slice(0, -1) : raw;
    if (!name || name.includes("/")) continue;
    result.add(name);
  }
  return result;
}

/**
 * Returns the set of ignored immediate child names of `dir`, or `null` when
 * `dir` is not inside a git repository (or git is unavailable / timed out). A
 * `null` result tells the caller to fall back to the static non-git ignore list.
 *
 * `--directory` keeps the output compact (ignored directories are folded into
 * one entry each), and `--exclude-standard` makes git honor `.gitignore`,
 * `$GIT_DIR/info/exclude`, and the global excludes file — matching what the
 * pi TUI's `fd` does.
 *
 * Results are cached for a short window on `globalThis` (survives Next.js
 * hot-reload) and concurrent calls for the same directory share one git spawn,
 * so rapidly expanding/refreshing folders never piles up child processes. A
 * failed/timed-out git is also cached (as `null`) for the same TTL so a broken
 * git environment degrades to the static fallback instantly instead of hanging
 * the UI on every listing.
 */
export async function listIgnoredImmediateNames(dir: string): Promise<Set<string> | null> {
  const cache = getCache();
  const now = Date.now();

  const cached = cache.get(dir);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  // Dedup concurrent calls for the same directory.
  const inFlight = getInFlight();
  const existing = inFlight.get(dir);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["-C", dir, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
        {
          timeout: GIT_IGNORE_TIMEOUT_MS,
          maxBuffer: GIT_IGNORE_MAX_BUFFER,
          // Never let git block on an interactive prompt (e.g. credentials) —
          // fail fast so the timeout is the only wait the user ever sees.
          env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
        },
      );
      return parseIgnoredImmediateNames(stdout);
    } catch {
      return null;
    }
  })();

  inFlight.set(dir, promise);
  try {
    const value = await promise;
    // Re-read the clock after the (possibly slow) git spawn. Using the entry
    // time `now` here would shrink the cache window by up to the git timeout
    // (4s), so a consistently slow directory would effectively never be cached
    // and re-spawn git on every listing.
    const settledAt = Date.now();
    // Evict expired entries, then drop the whole cache if it is still full
    // (matches the file-index route's bounded-cache strategy).
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= settledAt) cache.delete(key);
    }
    if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
    cache.set(dir, { value, expiresAt: settledAt + CACHE_TTL_MS });
    return value;
  } finally {
    inFlight.delete(dir);
  }
}

/** Test-only: clear the cache and in-flight map. */
export function __resetGitIgnoreCacheForTests(): void {
  globalThis.__piGitIgnoreCache = new Map();
  globalThis.__piGitIgnoreInFlight = new Map();
}
