import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  composer,
  DOCUMENT,
  renderPanel,
  SCREENSHOT,
} from "./agent-panel.fixtures";

const mocks = vi.hoisted(() => ({ agentImage: vi.fn() }));

vi.mock("./agent-images", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-images")>()),
  agentImage: mocks.agentImage,
}));

function pasteScreenshot() {
  const file = new File(["png"], SCREENSHOT.name, { type: "image/png" });
  fireEvent.paste(composer(), {
    clipboardData: {
      files: [file],
      items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
      types: ["Files", "text/plain"],
      getData: (type: string) =>
        type === "text/plain" ? `/Users/me/Desktop/${SCREENSHOT.name}` : "",
    },
  });
  return file;
}

const attachment = () =>
  screen.findByRole("listitem", { name: SCREENSHOT.name });

afterEach(() => {
  window.localStorage.clear();
  mocks.agentImage.mockReset();
});

describe("Ask Claude images", () => {
  it("attaches a pasted screenshot instead of typing its path", async () => {
    renderPanel();

    pasteScreenshot();

    expect(await attachment()).toBeTruthy();
    expect(composer().value).toBe("");
  });

  it("sends attached images with the request, then clears them", async () => {
    mocks.agentImage.mockResolvedValue(SCREENSHOT);
    const { session } = renderPanel();
    const file = pasteScreenshot();
    await attachment();

    fireEvent.change(composer(), { target: { value: "match this layout" } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    await waitFor(() =>
      expect(session.send).toHaveBeenCalledWith(
        { prompt: "match this layout", images: [SCREENSHOT], selection: null },
        DOCUMENT
      )
    );
    expect(mocks.agentImage).toHaveBeenCalledWith(file);
    expect(
      screen.queryByRole("listitem", { name: SCREENSHOT.name })
    ).toBeNull();
  });

  it("keeps the draft and flags the image when it cannot be read", async () => {
    mocks.agentImage.mockRejectedValue(new Error("decode failed"));
    const { session } = renderPanel();
    pasteScreenshot();
    await attachment();

    fireEvent.change(composer(), { target: { value: "match this layout" } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    expect(await screen.findByText("Couldn’t read this image")).toBeTruthy();
    expect(session.send).not.toHaveBeenCalled();
    expect(composer().value).toBe("match this layout");
  });

  it("shows the images that went with an earlier request", () => {
    renderPanel({
      messages: [
        { key: "you-1", role: "you", text: "match this", images: [SCREENSHOT] },
      ],
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: `Open attachment: ${SCREENSHOT.name}`,
      })
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(
      `data:image/png;base64,${SCREENSHOT.base64}`
    );
  });
});
