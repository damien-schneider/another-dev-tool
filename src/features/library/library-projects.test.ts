import { describe, expect, it } from "vitest";

import type { FileRow, Root } from "@/lib/ipc-types";

import { filesInProject, projectOf } from "./library-projects";

const HOME = "/Users/me";
const MASTRA = `${HOME}/GitHub/mastra/mastra`;
const SKILLS = `${HOME}/GitHub/skills`;
const LINK = `${HOME}/.claude/skills/humanizer/SKILL.md`;
const roots: Root[] = [
  { id: 1, path: `${HOME}/GitHub`, enabled: true, addedAt: 0 },
  { id: 2, path: `${HOME}/.claude`, enabled: true, addedAt: 0 },
];

function file(
  id: number,
  path: string,
  overrides: Partial<FileRow> = {}
): FileRow {
  return {
    id,
    rootId: path.startsWith(`${HOME}/GitHub`) ? 1 : 2,
    path,
    relPath: path,
    kind: "skill",
    name: null,
    description: null,
    aliases: [],
    projectDir: null,
    repositoryDir: null,
    size: 1,
    mtimeNs: 1,
    hash: `h${id}`,
    isSymlink: false,
    symlinkTarget: null,
    firstSeenAt: 0,
    lastSeenScanId: 1,
    deletedAt: null,
    ...overrides,
  };
}

const personal = file(1, `${HOME}/.claude/agents/reviewer.md`);
const mastraSkill = file(2, `${MASTRA}/.claude/skills/release/SKILL.md`, {
  projectDir: MASTRA,
});
const worktreeSkill = file(
  3,
  `${HOME}/GitHub/mastra/.worktrees/fix-auth/.claude/skills/release/SKILL.md`,
  {
    projectDir: `${HOME}/GitHub/mastra/.worktrees/fix-auth`,
    repositoryDir: MASTRA,
  }
);
const echoRules = file(4, `${HOME}/GitHub/echo/AGENTS.md`, {
  projectDir: `${HOME}/GitHub/echo`,
});
const linkedSkill = file(5, `${SKILLS}/humanizer/SKILL.md`, {
  projectDir: SKILLS,
  aliases: [LINK],
});

describe("projectOf", () => {
  it("opens a worktree's file in the repository it checks out, wherever the worktree lives", () => {
    expect(projectOf(worktreeSkill, roots, HOME)).toBe(MASTRA);
  });

  it("opens a file under a .worktrees folder that checks out no repository in that folder", () => {
    const draft = `${HOME}/GitHub/notes/.worktrees/draft`;
    expect(
      projectOf(
        file(6, `${draft}/AGENTS.md`, { projectDir: draft }),
        roots,
        HOME
      )
    ).toBe(draft);
  });

  it("opens a file picked through its link in ~/.claude in no project", () => {
    expect(projectOf(linkedSkill, roots, HOME)).toBe(SKILLS);
    expect(projectOf(linkedSkill, roots, HOME, LINK)).toBeNull();
  });
});

describe("filesInProject", () => {
  it("keeps the project with its worktrees and the personal files, and drops other projects", () => {
    expect(
      filesInProject(
        [personal, mastraSkill, worktreeSkill, echoRules],
        roots,
        HOME,
        MASTRA,
        false
      )
    ).toEqual([personal, mastraSkill, worktreeSkill]);
  });

  it("keeps another project's skill linked into ~/.claude only while links are shown", () => {
    expect(filesInProject([linkedSkill], roots, HOME, MASTRA, true)).toEqual([
      linkedSkill,
    ]);
    expect(filesInProject([linkedSkill], roots, HOME, MASTRA, false)).toEqual(
      []
    );
  });
});
