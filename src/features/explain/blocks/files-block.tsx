import { Badge, type BadgeColor } from "@ctrl-ui/react/ui/badge";
import { Text } from "@ctrl-ui/react/ui/typography";
import { Folder } from "lucide-react";

import { CodeRefLink } from "../source/code-ref-link";
import type { FileChange, FileSpec, FilesSpec } from "./block-specs";

const CHANGE_COLORS: Record<FileChange, BadgeColor> = {
  added: "green",
  modified: "blue",
  deleted: "red",
  renamed: "purple",
};

function byDirectory(files: FileSpec[]) {
  const groups = new Map<string, FileSpec[]>();
  for (const file of files) {
    const directory = file.ref.path.split("/").slice(0, -1).join("/");
    groups.set(directory, [...(groups.get(directory) ?? []), file]);
  }
  return [...groups];
}

export function FilesBlock({ spec }: { spec: FilesSpec }) {
  return (
    <div className="flex flex-col gap-3">
      {byDirectory(spec.files).map(([directory, files]) => (
        <section aria-label={directory || "Project root"} key={directory}>
          <div className="flex items-center gap-1.5 pb-1">
            <Folder
              aria-hidden="true"
              className="text-muted-foreground size-3.5 shrink-0"
            />
            <Text className="min-w-0 truncate" mono size="caption" tone="muted">
              {directory || "./"}
            </Text>
          </div>
          <ul className="divide-border flex flex-col divide-y">
            {files.map((file) => (
              <li
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5"
                key={`${file.ref.path}:${file.ref.start ?? ""}`}
              >
                <CodeRefLink codeRef={file.ref} />
                {file.change ? (
                  <Badge color={CHANGE_COLORS[file.change]} size="sm">
                    {file.change}
                  </Badge>
                ) : null}
                {file.role ? (
                  <Text
                    className="min-w-0 flex-1 basis-48"
                    size="caption"
                    tone="muted"
                  >
                    {file.role}
                  </Text>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
