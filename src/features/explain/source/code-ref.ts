export interface CodeRef {
  /** Relative to the explained project, with `/` separators. */
  path: string;
  start: number | null;
  end: number | null;
}

const PATH = String.raw`(?:\.\/)?([\w@+.$()[\]-]+(?:\/[\w@+.$()[\]-]+)*)`;
const COLON_LINES = String.raw`:(\d+)(?:[-–](\d+))?(?::\d+)?`;
const ANCHOR_LINES = String.raw`#L(\d+)(?:-L?(\d+))?`;
const REF_PATTERN = new RegExp(`^${PATH}(?:${COLON_LINES}|${ANCHOR_LINES})?$`);
const EXTENSION_PATTERN = /\.[A-Za-z][\w-]*$/;

const ROOT_FILES: readonly string[] = [
  "AGENTS.md",
  "CHANGELOG.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "Cargo.toml",
  "Dockerfile",
  "Gemfile",
  "Justfile",
  "LICENSE",
  "Makefile",
  "Procfile",
  "README.md",
  "Rakefile",
  "build.gradle",
  "composer.json",
  "deno.json",
  "go.mod",
  "package.json",
  "pom.xml",
  "pyproject.toml",
  "tsconfig.json",
];

function lineNumber(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return parsed > 0 ? parsed : null;
}

export function parseCodeRef(text: string): CodeRef | null {
  const match = REF_PATTERN.exec(text.trim());
  const path = match?.[1];
  if (!(match && path)) {
    return null;
  }
  const start = lineNumber(match[2] ?? match[4]);
  const end = lineNumber(match[3] ?? match[5]);
  const name = path.split("/").at(-1) ?? path;
  const rootFile = ROOT_FILES.includes(name);
  const hasFileName = rootFile || EXTENSION_PATTERN.test(name);
  const hasLocation = start !== null || path.includes("/");
  if (!(hasFileName && (hasLocation || rootFile))) {
    return null;
  }
  return {
    path,
    start,
    end: start !== null && end !== null && end > start ? end : null,
  };
}

export function formatCodeRef(ref: CodeRef): string {
  if (ref.start === null) {
    return ref.path;
  }
  return ref.end === null
    ? `${ref.path}:${ref.start}`
    : `${ref.path}:${ref.start}-${ref.end}`;
}

export function codeRefLabel(ref: CodeRef): string {
  return formatCodeRef({
    ...ref,
    path: ref.path.split("/").at(-1) ?? ref.path,
  });
}

export function refLines(ref: CodeRef): number[] {
  const { start, end } = ref;
  if (start === null) {
    return [];
  }
  return Array.from(
    { length: (end ?? start) - start + 1 },
    (_, offset) => start + offset
  );
}
