import type { SkillDraft } from "@/features/library/new-skill-dialog";
import { splitFrontmatter } from "@/lib/agent-files/frontmatter";
import { readFrontmatterFields } from "@/lib/frontmatter-fields";
import type { Pattern } from "@/lib/patterns-ipc-types";

const LEADING_BLANK_LINES = /^(?:[^\S\n]*\n)+/;
const TRAILING_WHITESPACE = /\s+$/;

export function applyChangePrompt(pattern: Pattern) {
  return `Apply this change. Keep everything else as it is; if a line already says the same thing, reword that line instead of adding a second one.\n\n${pattern.change}\n\nWhy: ${pattern.statement}`;
}

export function changeBody(change: string) {
  return splitFrontmatter(change).body;
}

export function skillDraft(change: string): SkillDraft {
  const { frontmatter, body } = splitFrontmatter(change);
  const { name, description } = readFrontmatterFields(frontmatter);
  const text = body
    .replace(LEADING_BLANK_LINES, "")
    .replace(TRAILING_WHITESPACE, "");
  return { name, description, body: `${text}\n` };
}
