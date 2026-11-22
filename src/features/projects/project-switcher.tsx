import { cn } from "@ctrl-ui/react/lib/cn";
import { Button } from "@ctrl-ui/react/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@ctrl-ui/react/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@ctrl-ui/react/ui/popover";
import { Check, ChevronsUpDown, Folders } from "lucide-react";
import { type KeyboardEvent, useState } from "react";

import { displayPath } from "@/features/destinations/destination-path";
import {
  FolderRow,
  isStarShortcut,
  PickerNote,
  StarShortcutHint,
} from "@/features/destinations/destination-rows";
import type { LibraryScope } from "@/features/library/library-model";
import { pathName } from "@/features/library/library-paths";
import { useHomeDirectory } from "@/lib/home-dir";

const ALL_PROJECTS_LABEL = "All projects";
const ALL_PROJECTS_VALUE = "__all__";
const WHITESPACE_PATTERN = /\s+/;

export function ProjectSwitcher({
  favoritePaths,
  onOpen,
  onToggleFavorite,
  project,
  projects,
}: {
  favoritePaths: ReadonlySet<string>;
  onOpen: (path: string | null) => void;
  onToggleFavorite: (path: string) => Promise<void>;
  project: string | null;
  projects: readonly LibraryScope[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState("");
  const home = useHomeDirectory();

  const words = query
    .trim()
    .toLowerCase()
    .split(WHITESPACE_PATTERN)
    .filter(Boolean);
  const matching = projects.filter((candidate) => {
    const haystack = displayPath(candidate.path, home).toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  const groups = [
    {
      heading: "Favorites",
      projects: matching.filter((candidate) =>
        favoritePaths.has(candidate.path)
      ),
    },
    {
      heading: "Projects",
      projects: matching.filter(
        (candidate) => !favoritePaths.has(candidate.path)
      ),
    },
  ].filter((group) => group.projects.length > 0);
  const label = project === null ? ALL_PROJECTS_LABEL : pathName(project);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setQuery("");
      setHighlighted(project ?? ALL_PROJECTS_VALUE);
    }
  };

  const choose = (path: string | null) => {
    onOpen(path);
    setOpen(false);
  };

  const starHighlighted = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      isStarShortcut(event) &&
      matching.some((candidate) => candidate.path === highlighted)
    ) {
      event.preventDefault();
      onToggleFavorite(highlighted);
    }
  };

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
          label="Projects"
          onKeyDown={starHighlighted}
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
            {words.length === 0 ? (
              <CommandItem
                onSelect={() => choose(null)}
                value={ALL_PROJECTS_VALUE}
              >
                <Folders
                  aria-hidden="true"
                  className="text-muted-foreground size-4 shrink-0"
                />
                <span className="min-w-0 flex-1 truncate">
                  {ALL_PROJECTS_LABEL}
                </span>
                <Check
                  aria-hidden="true"
                  className={cn(
                    "size-4 shrink-0",
                    project !== null && "invisible"
                  )}
                />
                {project === null ? (
                  <span className="sr-only">Current</span>
                ) : null}
              </CommandItem>
            ) : null}

            {groups.map((group) => (
              <CommandGroup heading={group.heading} key={group.heading}>
                {group.projects.map((candidate) => (
                  <FolderRow
                    folder={{
                      available: true,
                      favorite: favoritePaths.has(candidate.path),
                      fileCount: candidate.entryCount,
                      path: candidate.path,
                    }}
                    highlighted={candidate.path === highlighted}
                    home={home}
                    key={candidate.path}
                    onSelect={choose}
                    onToggleFavorite={onToggleFavorite}
                    selected={candidate.path === project}
                    selectedLabel="Current"
                  />
                ))}
              </CommandGroup>
            ))}

            {words.length > 0 && matching.length === 0 ? (
              <PickerNote>No project matches</PickerNote>
            ) : null}
          </CommandList>

          {matching.length > 0 ? (
            <div className="border-border flex justify-end border-t py-2">
              <StarShortcutHint />
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
