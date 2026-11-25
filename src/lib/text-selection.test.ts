import { describe, expect, it } from "vitest";

import { textSelection } from "./text-selection";

describe("textSelection", () => {
  it.each([
    {
      selection: "a part of two lines",
      before: "# Title\n\nKeep it ",
      selected: "short.\nAnd kind",
      expected: { text: "short.\nAnd kind", firstLine: 3, lastLine: 4 },
    },
    {
      selection: "a whole line, its line break included",
      before: "# Title\n\n",
      selected: "Keep it short.\n",
      expected: { text: "Keep it short.", firstLine: 3, lastLine: 3 },
    },
    {
      selection: "text from the end of the line above",
      before: "# Title",
      selected: "\n\nKeep it",
      expected: { text: "Keep it", firstLine: 3, lastLine: 3 },
    },
  ])(
    "places $selection on the lines it covers",
    ({ before, selected, expected }) => {
      expect(textSelection(before, selected)).toEqual(expected);
    }
  );

  it("leaves out a selection of nothing but blank space", () => {
    expect(textSelection("# Title", "\n  \n")).toBeNull();
  });
});
