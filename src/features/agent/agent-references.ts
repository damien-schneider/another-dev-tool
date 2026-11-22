import { type FileKind, isFileKind } from "@/lib/agent-files/scan-targets";

export interface AgentReference {
  path: string;
  label: string;
  kind: FileKind | "folder";
}

const REFERENCE_TYPE = "application/x-another-dev-tool-reference";

function isReferenceKind(value: unknown): value is AgentReference["kind"] {
  return value === "folder" || isFileKind(value);
}

function isReference(value: unknown): value is AgentReference {
  return (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    typeof value.path === "string" &&
    "label" in value &&
    typeof value.label === "string" &&
    "kind" in value &&
    isReferenceKind(value.kind)
  );
}

export function writeReference(
  data: Pick<DataTransfer, "setData" | "effectAllowed">,
  reference: AgentReference
) {
  data.setData(REFERENCE_TYPE, JSON.stringify(reference));
  data.effectAllowed = "copy";
}

/** Readable while dragging, unlike the payload, which only a drop can read. */
export function carriesReference(data: Pick<DataTransfer, "types">): boolean {
  return data.types.includes(REFERENCE_TYPE);
}

export function readReference(
  data: Pick<DataTransfer, "getData">
): AgentReference | null {
  const payload = data.getData(REFERENCE_TYPE);
  if (!payload) {
    return null;
  }
  const parsed: unknown = JSON.parse(payload);
  return isReference(parsed) ? parsed : null;
}
