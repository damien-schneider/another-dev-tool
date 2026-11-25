export interface View {
  conversationId: string | null;
}

export interface Tagged<T> {
  view: View;
  value: T;
}

export const same = (a: View, b: View) => a.conversationId === b.conversationId;

export const keyOf = (view: View) => view.conversationId ?? "";

export const shown = <T>(tagged: Tagged<T> | null, view: View) =>
  tagged && same(tagged.view, view) ? tagged.value : null;
