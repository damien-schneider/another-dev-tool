import { restoreLineEndings } from "@/lib/agent-files/line-endings";

/** Fills its pane and scrolls on its own, so long files keep the header in place. */
export function SourceEditor({
  label,
  onChange,
  readOnly,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  value: string;
}) {
  return (
    <textarea
      aria-label={label}
      autoCapitalize="off"
      autoCorrect="off"
      className="text-body block h-full w-full resize-none bg-transparent px-10 py-8 font-mono leading-relaxed outline-none"
      onChange={(event) =>
        onChange(restoreLineEndings(event.target.value, value))
      }
      readOnly={readOnly}
      spellCheck={false}
      value={value}
    />
  );
}
