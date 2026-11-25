/** Mirrors agent::message::TextSelection: lines count from 1 and include both ends. */
export interface TextSelection {
  text: string;
  firstLine: number;
  lastLine: number;
}

const LEADING_BREAKS = /^\n+/;
const TRAILING_BREAKS = /\n+$/;

export const lineBreaks = (text: string) => text.split("\n").length - 1;

/** `before` and `selected` use `\n` line breaks; one at either end of the selection belongs to no selected line. */
export function textSelection(
  before: string,
  selected: string
): TextSelection | null {
  if (selected.trim() === "") {
    return null;
  }
  const unbroken = selected.replace(LEADING_BREAKS, "");
  const text = unbroken.replace(TRAILING_BREAKS, "");
  const firstLine =
    lineBreaks(before) + (selected.length - unbroken.length) + 1;
  return { text, firstLine, lastLine: firstLine + lineBreaks(text) };
}
