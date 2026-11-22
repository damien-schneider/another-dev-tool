import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { joinFrontmatter, splitFrontmatter } from "../frontmatter";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const SKIPPED_DIRS = new Set([".git", "node_modules", "target", "dist"]);
const MARKDOWN_FILE = /\.mdc?$/;

function collectMarkdown(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) {
        collectMarkdown(path, found);
      }
      continue;
    }
    if (entry.isFile() && MARKDOWN_FILE.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

const corpus = collectMarkdown(REPO_ROOT);

describe("frontmatter round-trip over the repository corpus", () => {
  it.each(corpus.map((path) => relative(REPO_ROOT, path)))(
    "rebuilds %s byte for byte",
    (relPath) => {
      const original = readFileSync(join(REPO_ROOT, relPath), "utf8");

      expect(joinFrontmatter(splitFrontmatter(original))).toBe(original);
    }
  );
});
