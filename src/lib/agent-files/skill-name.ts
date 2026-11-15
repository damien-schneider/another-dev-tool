const VALID_SKILL_NAME_PATTERN = /^[a-z0-9-]+$/;
const SPACES_PATTERN = /\s+/g;
const INVALID_CHARS_PATTERN = /[^a-z0-9-]/g;
const MULTIPLE_HYPHENS_PATTERN = /-+/g;
const LEADING_TRAILING_HYPHENS_PATTERN = /^-|-$/g;

export function validateSkillName(name: string): {
  valid: boolean;
  errors: string[];
  suggested?: string;
} {
  const errors: string[] = [];

  if (!name || name.length === 0) {
    errors.push("Skill name is required");
    return { valid: false, errors };
  }

  if (name.length > 64) {
    errors.push("Skill name must be at most 64 characters");
  }

  if (!VALID_SKILL_NAME_PATTERN.test(name)) {
    errors.push(
      "Skill name must contain only lowercase letters, numbers, and hyphens"
    );
  }

  if (name.startsWith("-") || name.endsWith("-")) {
    errors.push("Skill name cannot start or end with a hyphen");
  }

  if (name.includes("--")) {
    errors.push("Skill name cannot contain consecutive hyphens");
  }

  let suggested: string | undefined;
  if (errors.length > 0) {
    suggested = slugifySkillName(name);
  }

  return {
    valid: errors.length === 0,
    errors,
    suggested,
  };
}

export function slugifySkillName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(SPACES_PATTERN, "-")
    .replace(INVALID_CHARS_PATTERN, "")
    .replace(MULTIPLE_HYPHENS_PATTERN, "-")
    .replace(LEADING_TRAILING_HYPHENS_PATTERN, "")
    .slice(0, 64);
}
