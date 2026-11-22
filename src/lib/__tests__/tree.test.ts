import { describe, expect, it } from "vitest";

import type { FileRow } from "../ipc-types";
import {
  buildTree,
  fileIdOf,
  fileNodeId,
  folderNodeId,
  TREE_ROOT_ID,
  type TreeBase,
} from "../tree";

const GITHUB: TreeBase = { path: "/Users/me/GitHub", name: "GitHub" };
const CLAUDE: TreeBase = { path: "/Users/me/.claude", name: ".claude" };

function file(id: number, path: string): FileRow {
  return {
    id,
    rootId: 1,
    path,
    relPath: path,
    kind: "claude-md",
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
  };
}

function inGitHub(id: number, relPath: string): FileRow {
  return file(id, `${GITHUB.path}/${relPath}`);
}

describe("buildTree", () => {
  it("nests files under the folders between their base and them", () => {
    const { index } = buildTree(
      [inGitHub(1, "app/api/CLAUDE.md")],
      () => GITHUB
    );

    const rootBranch = index[TREE_ROOT_ID]?.childIds[0] as string;
    expect(index[rootBranch]?.name).toBe("GitHub");
    const appId = index[rootBranch]?.childIds[0] as string;
    expect(index[appId]?.name).toBe("app");
    const apiId = index[appId]?.childIds[0] as string;
    expect(index[apiId]?.name).toBe("api");
    expect(index[apiId]?.childIds).toEqual([fileNodeId(1)]);
    expect(index[fileNodeId(1)]?.file?.id).toBe(1);
  });

  it("shares folder nodes between siblings", () => {
    const { index } = buildTree(
      [inGitHub(1, "app/CLAUDE.md"), inGitHub(2, "app/AGENTS.md")],
      () => GITHUB
    );

    const folders = Object.values(index).filter(
      (node) => node.isFolder && node.name === "app"
    );
    expect(folders).toHaveLength(1);
    expect(folders[0]?.childIds).toHaveLength(2);
  });

  it("sorts folders before files, then alphabetically", () => {
    const { index } = buildTree(
      [inGitHub(1, "z.md"), inGitHub(2, "a.md"), inGitHub(3, "sub/nested.md")],
      () => GITHUB
    );

    const branch = index[TREE_ROOT_ID]?.childIds[0] as string;
    const names = index[branch]?.childIds.map((id) => index[id]?.name);
    expect(names).toEqual(["sub", "a.md", "z.md"]);
  });

  it("keeps one branch per base", () => {
    const personal = file(2, `${CLAUDE.path}/CLAUDE.md`);
    const { index } = buildTree([inGitHub(1, "CLAUDE.md"), personal], (row) =>
      row === personal ? CLAUDE : GITHUB
    );

    const names = index[TREE_ROOT_ID]?.childIds.map((id) => index[id]?.name);
    expect(names).toEqual([".claude", "GitHub"]);
  });

  it("drops files without a base", () => {
    const { index } = buildTree([inGitHub(1, "CLAUDE.md")], () => null);

    expect(index[TREE_ROOT_ID]?.childIds).toEqual([]);
  });

  it("drops a file outside its base, even one sharing the base's name", () => {
    const { index } = buildTree([inGitHub(1, "CLAUDE.md")], () => ({
      path: "/Users/me/Git",
      name: "Git",
    }));

    expect(index[TREE_ROOT_ID]?.childIds).toEqual([]);
  });

  it("returns a lone root node for an empty index", () => {
    const { index } = buildTree([], () => GITHUB);

    expect(Object.keys(index)).toEqual([TREE_ROOT_ID]);
  });

  it("lists every branch that has to open to reach a file, base first", () => {
    const { index, locations } = buildTree(
      [inGitHub(1, "app/api/CLAUDE.md")],
      () => GITHUB
    );

    const names = locations.get(fileNodeId(1))?.map((id) => index[id]?.name);
    expect(names).toEqual(["GitHub", "app", "api"]);
  });
});

describe("fileIdOf", () => {
  it("round-trips a file node id", () => {
    expect(fileIdOf(fileNodeId(42))).toBe(42);
  });

  it("returns null for a folder node", () => {
    expect(fileIdOf(folderNodeId("/Users/me/GitHub/app"))).toBeNull();
  });
});
