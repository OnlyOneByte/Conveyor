import { realpathSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { isTestFile, TEST_HELPER_DIRS } from "./summary";

const HELPER_TEXT = /\btest\W+helpers\b/;

const SPECIFIER = /\b(?:from|import|require)\s*\(?\s*(["'`])([^"'`]+)\1/g;

const TEST_SPECIFIER = /\.(test|spec)(\.[cm]?[jt]sx?)?$/;

export type Resolve = (specifier: string, from: string) => string | null;

export const runtimeResolver =
  (root: string): Resolve =>
  (specifier, from) => {
    try {
      const real = realpathSync(Bun.resolveSync(specifier, dirname(join(root, from))));
      return relative(realpathSync(root), real).split(sep).join("/");
    } catch {
      return null;
    }
  };

const inHelperDir = (path: string) =>
  TEST_HELPER_DIRS.some((dir) => path === dir.slice(0, -1) || path.startsWith(dir));

function specifierErrors(path: string, specifier: string, resolve: Resolve): string[] {
  const errors: string[] = [];
  const lexical = specifier.startsWith(".")
    ? posix.normalize(posix.join(posix.dirname(path), specifier))
    : null;
  const target = resolve(specifier, path);
  if ([lexical, target].some((landed) => landed !== null && inHelperDir(landed))) {
    errors.push(`${path} imports the test helper ${specifier}`);
  } else if (TEST_SPECIFIER.test(specifier) || (target !== null && isTestFile(target))) {
    errors.push(`${path} imports the test file ${specifier}`);
  }
  return errors;
}

export function sourceImportErrors(
  sources: string[],
  read: (path: string) => string,
  resolve: Resolve = () => null,
): string[] {
  return sources.flatMap((path) => {
    const text = read(path);
    const errors = [...text.matchAll(SPECIFIER)].flatMap((match) =>
      specifierErrors(path, match[2] ?? "", resolve),
    );
    if (errors.length === 0 && HELPER_TEXT.test(text)) {
      errors.push(`${path} names a test/helpers path`);
    }
    return [...new Set(errors)].map((error) => `${error}; only tests may`);
  });
}

export function symlinkErrors(staged: string): string[] {
  return staged
    .split("\0")
    .filter((entry) => entry.startsWith("120000 "))
    .map((entry) => entry.slice(entry.indexOf("\t") + 1))
    .filter((path) => path.startsWith("packages/") || path.startsWith("plugins/"))
    .map((path) => `${path} is a symlink; the coverage check can't see what it points at`);
}
