import {
  type MarkdownUrlPolicy,
  persistentUrlPolicy,
} from "@ctrl-ui/react/markdown-editor/url-policy";

const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const UNSAFE_PATH_PATTERN = /[\s\\]/;
const FIRST_PRINTABLE_CODE = 32;

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    if (character.charCodeAt(0) < FIRST_PRINTABLE_CODE) {
      return true;
    }
  }
  return false;
}

/**
 * Which URLs the visual editor keeps. Files link to their neighbours
 * (`references/forms.md`), so relative links stay editable; anything with a
 * scheme, and every image, must still pass the editor's own safety rules.
 */
export const isDocumentUrlAllowed: MarkdownUrlPolicy = (url, kind) => {
  if (kind === "image" || SCHEME_PATTERN.test(url)) {
    return persistentUrlPolicy(url, kind);
  }
  return (
    url !== "" &&
    !url.startsWith("//") &&
    !UNSAFE_PATH_PATTERN.test(url) &&
    !hasControlCharacter(url)
  );
};
