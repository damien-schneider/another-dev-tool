import { describe, expect, it } from "vitest";

import { slugifySkillName, validateSkillName } from "../skill-name";

describe("slugifySkillName", () => {
  it("turns a title into a lowercase hyphenated name", () => {
    expect(slugifySkillName("  My Cool Skill! ")).toBe("my-cool-skill");
  });

  it("keeps a long title valid when the 64-character cut lands on a hyphen", () => {
    const slug = slugifySkillName(`${"a".repeat(63)}-b`);

    expect(slug).toBe("a".repeat(63));
    expect(validateSkillName(slug).valid).toBe(true);
  });
});
