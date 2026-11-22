import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConversationHistory } from "./conversation-history";

const LATEST = /Tighten it/;
const EARLIER = /Add a title/;

function renderHistory(conversationId: string | null) {
  const session = {
    conversationId,
    conversations:
      conversationId === null
        ? []
        : [
            { id: "latest", title: "Tighten it", updatedAt: Date.now() },
            {
              id: "earlier",
              title: "Add a title",
              updatedAt: Date.now() - 7_200_000,
            },
          ],
    openConversation: vi.fn(),
    newConversation: vi.fn(),
  };
  render(<ConversationHistory heading="About this file" session={session} />);
  return session;
}

describe("ConversationHistory", () => {
  it("reopens an earlier conversation, with the open one checked", async () => {
    const session = renderHistory("latest");

    fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
    const current = await screen.findByRole("menuitemradio", { name: LATEST });
    expect(current.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: EARLIER }));

    expect(session.openConversation).toHaveBeenCalledWith("earlier");
  });

  it("starts a new conversation", () => {
    const session = renderHistory("latest");

    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));

    expect(session.newConversation).toHaveBeenCalled();
  });

  it("offers neither while the open conversation is already new and none exist", () => {
    renderHistory(null);

    expect(
      screen.getByRole("button", { name: "New conversation" })
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: "Conversations" })
    ).toHaveProperty("disabled", true);
  });
});
