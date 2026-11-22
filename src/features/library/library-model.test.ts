import { describe, expect, it } from "vitest";

import type { FileKind, FileRow, Root } from "@/lib/ipc-types";

import {
  buildLibraryModel,
  entryTitle,
  type LibraryCollection,
  type LibraryScope,
} from "./library-model";
import { withoutSubProjects } from "./sub-projects";

const HOME = "/Users/me";
const roots: Root[] = [
  { id: 1, path: `${HOME}/GitHub`, enabled: true, addedAt: 0 },
  { id: 2, path: `${HOME}/.claude`, enabled: true, addedAt: 0 },
];

function skill(
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

describe("buildLibraryModel", () => {
  it("lists a repository skill linked into an agent home in both sections", () => {
    const repo = `${HOME}/GitHub/skills`;
    const model = buildLibraryModel(
      [
        skill(1, `${repo}/writing/humanizer/SKILL.md`, {
          projectDir: repo,
          aliases: [`${HOME}/.claude/skills/humanizer/SKILL.md`],
        }),
      ],
      roots,
      HOME
    );

    const [personal] = model.personal;
    const [project] = model.projects;
    expect(personal?.label).toBe("Claude Code");
    expect(personal?.path).toBe(`${HOME}/.claude`);
    expect(project?.path).toBe(repo);

    const linked = personal?.collections[0]?.entries[0];
    const own = project?.collections[0]?.entries[0];
    expect(linked?.linked).toBe(true);
    expect(own?.linked).toBe(false);
    expect(linked?.id).not.toBe(own?.id);
    expect(linked && entryTitle(linked)).toBe("humanizer");
    expect(model.locationsByEntryId.get(linked?.id ?? "")?.branchIds[0]).toBe(
      personal?.id
    );
  });

  it("lists each file only where it lives once links are hidden", () => {
    const repo = `${HOME}/GitHub/skills`;
    const files = [
      skill(1, `${repo}/writing/humanizer/SKILL.md`, {
        projectDir: repo,
        aliases: [`${HOME}/.claude/skills/humanizer/SKILL.md`],
      }),
      skill(2, `${HOME}/.claude/skills/shared/SKILL.md`, {
        isSymlink: true,
        symlinkTarget: "/Volumes/team/skills/shared/SKILL.md",
      }),
    ];
    const model = buildLibraryModel(
      files,
      roots,
      HOME,
      new Set(),
      files,
      false
    );
    const titles = (scopes: LibraryScope[]) =>
      scopes.flatMap((scope) =>
        scope.collections.flatMap((collection) =>
          collection.entries.map(entryTitle)
        )
      );

    expect(titles(model.projects)).toEqual(["humanizer"]);
    expect(titles(model.personal)).toEqual(["shared"]);
  });

  it("keeps a repository's own .claude folder with the repository", () => {
    const repo = `${HOME}/GitHub/app`;
    const model = buildLibraryModel(
      [
        skill(1, `${repo}/.claude/skills/deploy/SKILL.md`, {
          projectDir: repo,
          aliases: [`${repo}/.agents/skills/deploy/SKILL.md`],
        }),
      ],
      roots,
      HOME
    );

    expect(model.personal).toEqual([]);
    expect(model.projects.map((scope) => scope.path)).toEqual([repo]);
    expect(model.projects[0]?.entryCount).toBe(2);
  });

  it("lists a link kept inside its repository in the folder holding the link", () => {
    const repo = `${HOME}/GitHub/skills`;
    const files = [
      skill(1, `${repo}/.agents/skills/ask-sonner/SKILL.md`, {
        projectDir: repo,
        aliases: [`${repo}/interface/ask-sonner/SKILL.md`],
      }),
      skill(2, `${repo}/interface/break/SKILL.md`, { projectDir: repo }),
    ];
    const listing = (showAliases: boolean) => {
      const [project] = buildLibraryModel(
        files,
        roots,
        HOME,
        new Set(),
        files,
        showAliases
      ).projects;
      return project?.collections.map((collection) => [
        collection.relativePath,
        collection.entries.map((entry) => [entryTitle(entry), entry.linked]),
      ]);
    };

    expect(listing(true)).toEqual([
      [".agents/skills", [["ask-sonner", false]]],
      [
        "interface",
        [
          ["ask-sonner", true],
          ["break", false],
        ],
      ],
    ]);
    expect(listing(false)).toEqual([
      [".agents/skills", [["ask-sonner", false]]],
      ["interface", [["break", false]]],
    ]);
  });

  it("treats an agent home that is itself a git repository as personal", () => {
    const model = buildLibraryModel(
      [
        skill(1, `${HOME}/.claude/skills/notes/SKILL.md`, {
          projectDir: `${HOME}/.claude`,
        }),
      ],
      roots,
      HOME
    );

    expect(model.personal.map((scope) => scope.path)).toEqual([
      `${HOME}/.claude`,
    ]);
    expect(model.projects).toEqual([]);
  });

  it("keeps a repository named like an agent folder under Projects", () => {
    const repo = `${HOME}/GitHub/opencode`;
    const model = buildLibraryModel(
      [
        skill(1, `${repo}/skills/review/SKILL.md`, { projectDir: repo }),
        skill(2, `${HOME}/.config/opencode/skills/plan/SKILL.md`),
      ],
      roots,
      HOME
    );

    expect(model.projects.map((scope) => scope.path)).toEqual([repo]);
    expect(model.personal.map((scope) => scope.label)).toEqual(["OpenCode"]);
  });

  it("lists a worktree inside its repository, setting apart what matches the repository", () => {
    const repo = `${HOME}/GitHub/mastra/mastra`;
    const worktree = `${HOME}/GitHub/mastra/.worktrees/fix-login`;
    const inRepo = (id: number, root: string, name: string, hash: string) =>
      skill(id, `${root}/.claude/skills/${name}/SKILL.md`, {
        projectDir: root,
        repositoryDir: root === repo ? null : repo,
        hash,
      });
    const indexed = [
      inRepo(1, repo, "a", "same"),
      inRepo(2, repo, "b", "before"),
      inRepo(3, worktree, "a", "same"),
      inRepo(4, worktree, "b", "after"),
      inRepo(5, worktree, "c", "new"),
      inRepo(6, `${repo}/.claude/worktrees/alpha`, "a", "same"),
    ];
    const model = buildLibraryModel(indexed, roots, HOME);

    expect(model.projects.map((scope) => scope.path)).toEqual([repo]);
    const [project] = model.projects;
    expect(
      project?.worktrees.map((scope) => [scope.label, scope.entryCount])
    ).toEqual([
      ["fix-login", 2],
      ["alpha", 0],
    ]);
    const [fixLogin] = project?.worktrees ?? [];
    const titles = (collections: LibraryCollection[] = []) =>
      collections.flatMap((collection) => collection.entries.map(entryTitle));
    expect(titles(fixLogin?.collections)).toEqual(["b", "c"]);
    expect(titles(fixLogin?.unchanged)).toEqual(["a"]);

    const searched = buildLibraryModel(
      indexed.filter((file) => file.path.startsWith(worktree)),
      roots,
      HOME,
      new Set(),
      indexed
    );
    expect(titles(searched.projects[0]?.worktrees[0]?.unchanged)).toEqual([
      "a",
    ]);
  });

  it("lists a folder under .worktrees that checks out no repository as a project of its own", () => {
    const folder = `${HOME}/GitHub/notes/.worktrees/draft`;
    const model = buildLibraryModel(
      [
        skill(1, `${folder}/.claude/skills/a/SKILL.md`, {
          projectDir: folder,
        }),
      ],
      roots,
      HOME
    );

    expect(
      model.projects.map((scope) => [scope.label, scope.worktrees.length])
    ).toEqual([["draft", 0]]);
  });

  it("lists a file kept in a skill's folder inside the folder listing that skill", () => {
    const repo = `${HOME}/GitHub/skills`;
    const inRepo = (id: number, relative: string, kind: FileKind) =>
      skill(id, `${repo}/${relative}`, { kind, projectDir: repo });
    const model = buildLibraryModel(
      [
        inRepo(1, "emil/ask-lapse/SKILL.md", "skill"),
        inRepo(2, "emil/animate/SKILL.md", "skill"),
        inRepo(3, "emil/ask-lapse/AGENTS.md", "agents-md"),
      ],
      roots,
      HOME
    );

    const [project] = model.projects;
    const [emil] = project?.collections ?? [];
    expect(project?.collections.map((folder) => folder.relativePath)).toEqual([
      "emil",
    ]);
    expect(emil?.entryCount).toBe(3);
    expect(emil?.children.map((folder) => folder.relativePath)).toEqual([
      "ask-lapse",
    ]);
    const agentsMd = emil?.children[0]?.entries[0];
    expect(
      model.locationsByEntryId.get(agentsMd?.id ?? "")?.branchIds
    ).toContain(emil?.id);
  });
});

describe("withoutSubProjects", () => {
  const repo = `${HOME}/GitHub/mastra`;
  const inRepo = (id: number, relative: string, kind: FileKind) =>
    skill(id, `${repo}/${relative}`, { kind, projectDir: repo });
  const kept = (files: FileRow[]) =>
    withoutSubProjects(files, HOME).map((file) => file.id);

  it("hides a monorepo package that brings its own instructions, and everything in it", () => {
    expect(
      kept([
        inRepo(1, "AGENTS.md", "agents-md"),
        inRepo(2, ".claude/skills/review/SKILL.md", "skill"),
        inRepo(3, "packages/core/AGENTS.md", "agents-md"),
        inRepo(4, "packages/core/.claude/skills/codemod/SKILL.md", "skill"),
      ])
    ).toEqual([1, 2]);
  });

  it("keeps folders without their own instructions, like a skills collection", () => {
    expect(
      kept([
        inRepo(1, "writing/humanizer/SKILL.md", "skill"),
        inRepo(2, "writing/lapse/SKILL.md", "skill"),
        inRepo(3, "writing/lapse/AGENTS.md", "agents-md"),
      ])
    ).toEqual([1, 2, 3]);
  });

  it("keeps the repository's own config folder even when it holds instructions", () => {
    expect(
      kept([
        inRepo(1, ".claude/CLAUDE.md", "claude-md"),
        inRepo(2, ".claude/skills/review/SKILL.md", "skill"),
      ])
    ).toEqual([1, 2]);
  });

  it("keeps an agent home that is itself a git repository", () => {
    const files = [
      skill(1, `${HOME}/.claude/team/CLAUDE.md`, {
        kind: "claude-md",
        projectDir: `${HOME}/.claude`,
      }),
    ];
    expect(kept(files)).toEqual([1]);
  });
});
