import { cn } from "@ctrl-ui/react/lib/cn";
import { Button } from "@ctrl-ui/react/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@ctrl-ui/react/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@ctrl-ui/react/ui/popover";
import { Text } from "@ctrl-ui/react/ui/typography";
import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import type { AgentListing, AgentReadiness } from "@/lib/agent-ipc-types";

import type { AgentChoice } from "./use-agent-choice";

const NOT_READY: Partial<Record<AgentReadiness, string>> = {
  download: "Not installed",
  needsNode: "Needs Node.js",
  needsUv: "Needs uv",
};

function AgentIcon({ listing }: { listing: AgentListing | undefined }) {
  if (!listing?.icon) {
    return <span aria-hidden="true" className="block size-3.5 shrink-0" />;
  }
  return (
    <span
      aria-hidden="true"
      className="block size-3.5 shrink-0 bg-current mask-contain mask-center mask-no-repeat"
      style={{ maskImage: `url("${listing.icon}")` }}
    />
  );
}

export function AgentPicker({ choice }: { choice: AgentChoice }) {
  const [open, setOpen] = useState(false);
  const started = choice.preparing.state === "ready";
  const current = choice.listing?.name;
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            aria-label={`Agent: ${current ?? "none"}`}
            className="min-w-0 shrink gap-1.5"
            disabled={choice.listings.length === 0}
            size="xs"
            variant="ghost"
          />
        }
      >
        <AgentIcon listing={choice.listing} />
        <span className="max-w-44 truncate">{current ?? "Agent"}</span>
        <ChevronsUpDown aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 max-w-(--available-width)"
        padding="none"
      >
        <Command chrome="embedded" defaultValue={choice.agentId} label="Agent">
          <CommandInput placeholder="Search agents…" />
          <CommandList>
            <CommandEmpty title={choice.catalogError ?? "No agents found"} />
            {choice.listings.map((listing) => {
              const chosen = listing.id === choice.agentId;
              const hint =
                started && chosen ? undefined : NOT_READY[listing.readiness];
              return (
                <CommandItem
                  key={listing.id}
                  keywords={[listing.name]}
                  onSelect={() => {
                    setOpen(false);
                    choice.choose(listing.id);
                  }}
                  value={listing.id}
                >
                  <AgentIcon listing={listing} />
                  <span className="min-w-0 flex-1 truncate">
                    {listing.name}
                  </span>
                  {hint ? (
                    <Text
                      as="span"
                      className="shrink-0"
                      size="caption"
                      tone="muted"
                    >
                      {hint}
                    </Text>
                  ) : null}
                  <Check
                    aria-hidden="true"
                    className={cn("size-4 shrink-0", !chosen && "invisible")}
                  />
                  {chosen ? (
                    <span className="sr-only">Current agent</span>
                  ) : null}
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
