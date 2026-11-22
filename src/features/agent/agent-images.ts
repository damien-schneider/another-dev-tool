import type { DropzonePolicy } from "@ctrl-ui/react/ui/dropzone";

import type { AgentPromptImage } from "@/lib/agent-ipc-types";

type AgentImageType = AgentPromptImage["mediaType"];

export interface AgentImage extends AgentPromptImage {
  id: string;
}

export const MAX_AGENT_IMAGES = 8;

export const AGENT_IMAGE_POLICY: DropzonePolicy = {
  accept: {
    "image/png": [".png"],
    "image/jpeg": [".jpg", ".jpeg"],
    "image/gif": [".gif"],
    "image/webp": [".webp"],
  },
  maxFiles: MAX_AGENT_IMAGES,
  maxSize: 32 * 1024 * 1024,
};

/** Claude scales anything with a longer edge down to this before reading it. */
const LONG_EDGE = 1568;

/** The API refuses a larger image outright. */
const MAX_BYTES = 5 * 1024 * 1024;

export function fitWithin(width: number, height: number, limit = LONG_EDGE) {
  const scale = Math.min(1, limit / Math.max(width, height));
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

const isAgentImageType = (type: string): type is AgentImageType =>
  type in (AGENT_IMAGE_POLICY.accept ?? {});

function readBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function encode(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  type: "image/png" | "image/jpeg"
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Could not encode the image")),
      type,
      0.9
    );
  });
}

/** Sized the way Claude reads it: smaller uploads, same result. */
export async function agentImage(file: File): Promise<AgentImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const size = fitWithin(bitmap.width, bitmap.height);
    if (
      size.width === bitmap.width &&
      isAgentImageType(file.type) &&
      file.size <= MAX_BYTES
    ) {
      return {
        id: crypto.randomUUID(),
        name: file.name,
        mediaType: file.type,
        base64: await readBase64(file),
        ...size,
      };
    }
    let mediaType: "image/png" | "image/jpeg" =
      file.type === "image/jpeg" ? "image/jpeg" : "image/png";
    let blob = await encode(bitmap, size.width, size.height, mediaType);
    if (blob.size > MAX_BYTES) {
      mediaType = "image/jpeg";
      blob = await encode(bitmap, size.width, size.height, mediaType);
    }
    return {
      id: crypto.randomUUID(),
      name: file.name,
      mediaType,
      base64: await readBase64(blob),
      ...size,
    };
  } finally {
    bitmap.close();
  }
}

export const imageSource = (image: AgentImage) =>
  `data:${image.mediaType};base64,${image.base64}`;
