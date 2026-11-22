import { Button } from "@ctrl-ui/react/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandList,
} from "@ctrl-ui/react/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@ctrl-ui/react/ui/popover";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ChevronsUpDown, FolderOpen } from "lucide-react";
import { useState } from "react";

import { displayPath } from "@/features/destinations/destination-path";
import {
  FolderRow,
  PickerNote,
  PickerRow,
} from "@/features/destinations/destination-rows";
import type { LibraryScope } from "@/features/library/library-model";
import { pathName } from "@/features/library/library-paths";
import { useHomeDirectory } from "@/lib/home-dir";
import { explainRecentProjects } from "@/lib/ipc";

const CHOOSE_FOLDER_VALUE = "__choose__";
const WHITESPACE_PATTERN = /\s+/;

export async function chooseFolder() {
  const picked = await openDialog({
    directory: true,
    title: "Choose a folder to explain",
  });
  return typeof picked === "string" ? picked : null;
}

export function ExplainProjectPicker({
  favoritePaths,
  onChange,
  onToggleFavorite,
  project,
  projects,
}: {
  favoritePaths: ReadonlySet<string>;
  onChange: (path: string) => void;
  onToggleFavorite: (path: string) => Promise<void>;
  project: string | null;
  projects: readonly LibraryScope[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const home = useHomeDirectory();

  const words = query
    .trim()
    .toLowerCase()
    .split(WHITESPACE_PATTERN)
    .filter(Boolean);
  const matches = (path: string) => {
    const haystack = displayPath(path, home).toLowerCase();
    return words.every((word) => haystack.includes(word));
  };
  const known = projects.map((candidate) => candidate.path);
  const groups = [
    { heading: "Recent", paths: recent },
    {
      heading: "Favorites",
      paths: known.filter(
        (path) => favoritePaths.has(path) && !recent.includes(path)
      ),
    },
    {
      heading: "Projects",
      paths: known.filter(
        (path) => !(favoritePaths.has(path) || recent.includes(path))
      ),
    },
  ]
    .map((group) => ({ ...group, paths: group.paths.filter(matches) }))
    .filter((group) => group.paths.length > 0);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setQuery("");
      setHighlighted(project ?? "");
      explainRecentProjects()
        .then((found) => setRecent(found.map((entry) => entry.path)))
        .catch(() => setRecent([]));
    }
  };

  const choose = (path: string) => {
    onChange(path);
    setOpen(false);
  };

  const browse = async () => {
    setOpen(false);
    const picked = await chooseFolder();
    if (picked) {
      onChange(picked);
    }
  };

  const label = project === null ? "Choose a project" : pathName(project);

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger
        render={
          <Button
            aria-label={`Project: ${label}`}
            className="min-w-0 shrink"
            size="sm"
            title={project ?? undefined}
            variant="ghost"
          />
        }
      >
        <span className="truncate">{label}</span>
        <ChevronsUpDown />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-104 max-w-(--available-width)"
        padding="none"
      >
        <Command
          chrome="embedded"
          label="Projects to explain"
          onValueChange={setHighlighted}
          shouldFilter={false}
          value={highlighted}
        >
          <CommandInput
            onValueChange={setQuery}
            placeholder="Search projects"
            value={query}
          />
          <CommandList>
            {groups.map((group) => (
              <CommandGroup heading={group.heading} key={group.heading}>
                {group.paths.map((path) => (
                  <FolderRow
                    folder={{
                      available: true,
                      favorite: favoritePaths.has(path),
                      fileCount: 0,
                      path,
                    }}
                    highlighted={path === highlighted}
                    home={home}
                    key={path}
                    onSelect={choose}
                    onToggleFavorite={onToggleFavorite}
                    selected={path === project}
                    selectedLabel="Current"
                  />
                ))}
              </CommandGroup>
            ))}
            {words.length > 0 && groups.length === 0 ? (
              <PickerNote>No project matches</PickerNote>
            ) : null}
            <CommandGroup>
              <PickerRow
                icon={
                  <FolderOpen
                    aria-hidden="true"
                    className="text-muted-foreground size-4 shrink-0"
                  />
                }
                onSelect={browse}
                value={CHOOSE_FOLDER_VALUE}
              >
                Choose a folder…
              </PickerRow>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
