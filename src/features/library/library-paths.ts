const SEPARATOR_PATTERN = /[\\/]+/;
const TRAILING_SLASH_PATTERN = /\/$/;

/** Folders in the user's home that an agent reads per-user files from, in display order. */
const AGENT_HOMES: readonly {
  folder: string;
  label: string;
  skillFolders: readonly string[];
}[] = [
  {
    folder: ".claude",
    label: "Claude Code",
    skillFolders: ["skills", "skills/synced/*"],
  },
  { folder: ".agents", label: "Shared agents", skillFolders: ["skills"] },
  {
    folder: ".codex",
    label: "Codex",
    skillFolders: ["skills", "skills/.system"],
  },
  { folder: ".cursor", label: "Cursor", skillFolders: ["skills"] },
  { folder: ".gemini", label: "Gemini", skillFolders: ["skills"] },
  { folder: ".config/opencode", label: "OpenCode", skillFolders: ["skills"] },
  { folder: ".mastracode", label: "Mastra Code", skillFolders: ["skills"] },
];

export function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(TRAILING_SLASH_PATTERN, "");
}

export function pathName(path: string): string {
  return path.split(SEPARATOR_PATTERN).filter(Boolean).at(-1) ?? path;
}

export function parentPath(path: string): string {
  const normalizedPath = normalizePath(path);
  const separatorIndex = normalizedPath.lastIndexOf("/");
  return separatorIndex <= 0
    ? normalizedPath
    : normalizedPath.slice(0, separatorIndex);
}

export function isWithin(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

export function relativePath(path: string, basePath: string): string {
  const normalizedPath = normalizePath(path);
  const normalizedBasePath = normalizePath(basePath);
  if (normalizedPath === normalizedBasePath) {
    return "";
  }
  return normalizedPath.startsWith(`${normalizedBasePath}/`)
    ? normalizedPath.slice(normalizedBasePath.length + 1)
    : normalizedPath;
}

/** An agent's per-user folder, e.g. `~/.claude`. */
export interface AgentHome {
  path: string;
  label: string;
  rank: number;
}

/** The agent home folder in `home` that a path sits in. */
export function agentHomeOf(
  path: string,
  home: string | null
): AgentHome | null {
  if (home === null) {
    return null;
  }
  for (const [rank, { folder, label }] of AGENT_HOMES.entries()) {
    const homePath = `${normalizePath(home)}/${folder}`;
    if (isWithin(normalizePath(path), homePath)) {
      return { path: homePath, label, rank };
    }
  }
  return null;
}

export interface SkillReach {
  loaded: boolean;
  homes: AgentHome[];
}

function endsWithFolders(path: string, pattern: string): boolean {
  const wanted = pattern.split("/");
  const tail = path.split("/").slice(-wanted.length);
  return (
    tail.length === wanted.length &&
    wanted.every((folder, index) => folder === "*" || folder === tail[index])
  );
}

function inAgentSkillsFolder(path: string): boolean {
  const skillsFolder = parentPath(parentPath(path));
  return AGENT_HOMES.some(({ folder, skillFolders }) =>
    skillFolders.some((skills) =>
      endsWithFolders(skillsFolder, `${folder}/${skills}`)
    )
  );
}

export function skillReach(
  paths: readonly string[],
  home: string | null
): SkillReach {
  const loading = paths.filter(inAgentSkillsFolder);
  const homes = new Map<string, AgentHome>();
  for (const path of loading) {
    const agentHome = agentHomeOf(path, home);
    if (agentHome) {
      homes.set(agentHome.path, agentHome);
    }
  }
  return {
    loaded: loading.length > 0,
    homes: [...homes.values()].sort((left, right) => left.rank - right.rank),
  };
}
