export type LineEnding = "\n" | "\r\n";

export function dominantLineEnding(text: string): LineEnding {
  let crlf = 0;
  let lf = 0;
  for (
    let index = text.indexOf("\n");
    index !== -1;
    index = text.indexOf("\n", index + 1)
  ) {
    if (text[index - 1] === "\r") {
      crlf += 1;
    } else {
      lf += 1;
    }
  }
  return crlf > lf ? "\r\n" : "\n";
}

// CodeMirror and <textarea> both hand text back with `\n` line breaks only.
export function restoreLineEndings(edited: string, before: string): string {
  const lineEnding = dominantLineEnding(before);
  return lineEnding === "\n" ? edited : edited.replaceAll("\n", lineEnding);
}
