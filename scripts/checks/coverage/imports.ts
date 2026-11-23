import { posix } from "node:path";
import { TEST_HELPER_DIRS } from "./summary";

const HELPER_TEXT = /\btest\W+helpers\b/;

const SPECIFIER = /\b(?:from|import|require)\s*\(?\s*(["'`])([^"'`]+)\1/g;

const TEST_SPECIFIER = /\.(test|spec)(\.[cm]?[jt]sx?)?$/;

const inHelperDir = (resolved: string) =>
  TEST_HELPER_DIRS.some((dir) => resolved === dir.slice(0, -1) || resolved.startsWith(dir));

function specifierErrors(path: string, specifier: string): string[] {
  const errors: string[] = [];
  if (specifier.startsWith(".")) {
    const resolved = posix.normalize(posix.join(posix.dirname(path), specifier));
    if (inHelperDir(resolved)) errors.push(`${path} imports the test helper ${specifier}`);
  }
  if (TEST_SPECIFIER.test(specifier)) errors.push(`${path} imports the test file ${specifier}`);
  return errors;
}

export function sourceImportErrors(sources: string[], read: (path: string) => string): string[] {
  return sources.flatMap((path) => {
    const text = read(path);
    const errors = [...text.matchAll(SPECIFIER)].flatMap((match) =>
      specifierErrors(path, match[2] ?? ""),
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
