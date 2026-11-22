import { describe, expect, it } from "vitest";

import { codeRefLabel, parseCodeRef, refLines } from "./code-ref";

describe("code references in answers", () => {
  it("reads a file with a line or a range, in either notation", () => {
    expect(parseCodeRef("src/cart.ts:12-30")).toEqual({
      path: "src/cart.ts",
      start: 12,
      end: 30,
    });
    expect(parseCodeRef("./src/cart.ts#L12-L30")).toEqual({
      path: "src/cart.ts",
      start: 12,
      end: 30,
    });
    expect(parseCodeRef("src/cart.ts:12:4")).toEqual({
      path: "src/cart.ts",
      start: 12,
      end: null,
    });
  });

  it("links a bare file name only when it is a well-known project file", () => {
    expect(parseCodeRef("Cargo.toml")?.path).toBe("Cargo.toml");
    expect(parseCodeRef("package.json")?.path).toBe("package.json");
    expect(parseCodeRef("Makefile")?.path).toBe("Makefile");
    expect(parseCodeRef("lib.rs:40")?.start).toBe(40);
    expect(parseCodeRef("docs/notes.txt")?.path).toBe("docs/notes.txt");
  });

  it("links framework route files whose names carry brackets, parentheses or dollars", () => {
    expect(parseCodeRef("app/(auth)/login/page.tsx:12")?.path).toBe(
      "app/(auth)/login/page.tsx"
    );
    expect(parseCodeRef("app/routes/posts.$id.tsx")?.path).toBe(
      "app/routes/posts.$id.tsx"
    );
    expect(parseCodeRef("pages/[slug].tsx:3-9")?.start).toBe(3);
  });

  it("leaves ordinary inline code alone", () => {
    for (const code of [
      "user.name",
      "api/v1",
      "npm run build",
      "Array.from",
      "config.value",
      "https://example.com/a.ts",
      "res.json",
      "el.html",
      "$el.css",
      "$(this).html",
      "Next.js",
    ]) {
      expect(parseCodeRef(code)).toBeNull();
    }
  });

  it("ignores a range that runs backwards", () => {
    expect(parseCodeRef("src/cart.ts:30-12")).toEqual({
      path: "src/cart.ts",
      start: 30,
      end: null,
    });
  });

  it("labels a reference by its file name and lines, and lists the lines it covers", () => {
    const ref = { path: "src/store/cart.ts", start: 4, end: 6 };
    expect(codeRefLabel(ref)).toBe("cart.ts:4-6");
    expect(refLines(ref)).toEqual([4, 5, 6]);
    expect(refLines({ ...ref, start: null, end: null })).toEqual([]);
  });
});
