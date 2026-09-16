import { gutter, gutters, GutterMarker, highlightActiveLineGutter, lineNumbers } from '@codemirror/view';
import type { Settings } from './types';

class LineNumber extends GutterMarker {
  constructor(readonly number: number) {
    super();
  }
  eq(other: LineNumber) {
    return this.number === other.number;
  }
  toDOM() {
    return document.createTextNode(String(this.number));
  }
}

export function editorLineNumbers(mode: Settings['lineNumbers']) {
  if (mode === 'none') return [];
  return [
    // The note scrolls as a whole; the gutter lives in its outer margin.
    gutters({ fixed: false }),
    mode === 'absolute'
      ? lineNumbers()
      : gutter({
          class: 'cm-lineNumbers',
          lineMarker(view, line) {
            const number = view.state.doc.lineAt(line.from).number;
            const current = view.state.doc.lineAt(view.state.selection.main.head).number;
            return new LineNumber(number === current ? number : Math.abs(number - current));
          },
          lineMarkerChange: (update) =>
            update.docChanged ||
            update.startState.doc.lineAt(update.startState.selection.main.head).number !==
              update.state.doc.lineAt(update.state.selection.main.head).number,
          initialSpacer: (view) => new LineNumber(view.state.doc.lines),
          updateSpacer: (spacer, update) =>
            update.docChanged ? new LineNumber(update.state.doc.lines) : spacer,
        }),
    highlightActiveLineGutter(),
  ];
}
