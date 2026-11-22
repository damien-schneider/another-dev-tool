import { type Extension, type Range, StateEffect } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type DOMEventHandlers,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

export const MENTION_ATTRIBUTE = "data-skill";
const MENTION_CLASS = "skill-mention";
const WORD_CHARACTER = /[a-z0-9-]/i;

export type MentionDomEvents = DOMEventHandlers<unknown>;

/** The editor is built once per document, so the index's latest names reach it through this store. */
export interface MentionStore {
  names: () => readonly string[];
  set: (names: readonly string[]) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createMentionStore(): MentionStore {
  const listeners = new Set<() => void>();
  let names: readonly string[] = [];

  return {
    names: () => names,
    set(next) {
      if (
        next.length === names.length &&
        next.every((name, index) => name === names[index])
      ) {
        return;
      }
      names = next;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function isBoundary(character: string | undefined): boolean {
  return character === undefined || !WORD_CHARACTER.test(character);
}

export interface MentionRange {
  name: string;
  from: number;
}

/** Whole-word occurrences of already-resolved names; the index decided which names link. */
export function mentionRanges(
  text: string,
  names: readonly string[]
): MentionRange[] {
  const haystack = text.toLowerCase();
  const ranges: MentionRange[] = [];

  for (const name of names) {
    let from = haystack.indexOf(name);
    while (from !== -1) {
      if (isBoundary(text[from - 1]) && isBoundary(text[from + name.length])) {
        ranges.push({ name, from });
      }
      from = haystack.indexOf(name, from + name.length);
    }
  }

  return ranges;
}

const namesChanged = StateEffect.define<null>();

function mentionDecorations(
  view: EditorView,
  names: readonly string[]
): DecorationSet {
  const mentions: Range<Decoration>[] = [];
  for (const visible of view.visibleRanges) {
    const text = view.state.sliceDoc(visible.from, visible.to);
    for (const { name, from } of mentionRanges(text, names)) {
      const start = visible.from + from;
      mentions.push(
        Decoration.mark({
          class: MENTION_CLASS,
          attributes: { [MENTION_ATTRIBUTE]: name },
        }).range(start, start + name.length)
      );
    }
  }
  return Decoration.set(mentions, true);
}

function isNamesChange(update: ViewUpdate): boolean {
  return update.transactions.some((transaction) =>
    transaction.effects.some((effect) => effect.is(namesChanged))
  );
}

export function skillMention(
  store: MentionStore,
  domEvents: MentionDomEvents
): Extension {
  const decorations = ViewPlugin.define(
    (view) => {
      const unsubscribe = store.subscribe(() => {
        view.dispatch({ effects: namesChanged.of(null) });
      });
      return {
        decorations: mentionDecorations(view, store.names()),
        update(update) {
          if (
            update.docChanged ||
            update.viewportChanged ||
            isNamesChange(update)
          ) {
            this.decorations = mentionDecorations(update.view, store.names());
          }
        },
        destroy: unsubscribe,
      };
    },
    { decorations: (plugin) => plugin.decorations }
  );
  return [decorations, EditorView.domEventHandlers(domEvents)];
}
