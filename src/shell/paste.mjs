// Large pastes in pir's typing boxes. pi-tui's Editor collapses a paste over 10 lines or 1000 characters
// into a `[paste #N +L lines]` marker and keeps the text aside (editor.js handlePaste); only its own submit
// path expands the markers again, so any caller that reads the box itself must use getExpandedText().
//
// typeInto adds what Claude Code does and pi-tui does not: pasting the same text a second time expands the
// earlier marker in place instead of adding a second one, so a person can see and edit what they pasted.
// It reads the Editor's `pastes` map, `pasteCounter`, `state` and `setCursorCol` — private in pi-tui's
// types but plain fields at runtime (0.87.1); paste.test.mjs pins them.

const markerRe = (id) => new RegExp(`\\[paste #${id}( (\\+\\d+ lines|\\d+ chars))?\\]`);

// typeInto(editor, data) — hand `data` to the Editor; if it was a paste repeating one already collapsed in
// the box, drop the new marker and expand the earlier one, the caret landing just after the expanded text.
export function typeInto(editor, data) {
  const pastes = editor.pastes;
  if (!(pastes instanceof Map)) return editor.handleInput(data);
  const before = new Map(pastes);
  editor.handleInput(data);
  const added = [...pastes.keys()].find((id) => !before.has(id));
  if (added === undefined) return;
  // pi-tui prefixes a space to a pasted path that follows a word character, so compare without it.
  const content = pastes.get(added);
  const earlier = [...before].find(([, c]) => c.trimStart() === content.trimStart())?.[0];
  if (earlier === undefined) return;

  const text = editor.getText().replace(markerRe(added), '');
  const at = text.search(markerRe(earlier));
  if (at === -1) return; // the earlier marker was deleted from the text: leave the new one as it is
  const full = before.get(earlier);
  const expanded = text.replace(markerRe(earlier), () => full);
  const counter = editor.pasteCounter;
  editor.setText(expanded); // clears the paste store: the markers still in the text are put back
  for (const [id, c] of before) if (id !== earlier) pastes.set(id, c);
  editor.pasteCounter = counter;

  const head = expanded.slice(0, at + full.length).split('\n');
  editor.state.cursorLine = head.length - 1;
  editor.setCursorCol(head[head.length - 1].length);
}
