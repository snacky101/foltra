// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { afterEach, expect, test, vi } from 'vitest';
import { editorLinkNavigation } from './wikiLinkNavigation';

let view: EditorView;
afterEach(() => view?.destroy());

test.each(['metaKey', 'ctrlKey'] as const)(
  '%s-click opens the clicked Markdown or wiki source without changing the caret',
  (modifier) => {
    const doc = '[[Note|Label]] and [website](https://example.com/path(a))';
    const openWiki = vi.fn();
    const openMarkdown = vi.fn();
    view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: [markdown(), editorLinkNavigation({ openWiki, openMarkdown })],
      }),
    });
    const coords = vi.spyOn(view, 'posAtCoords').mockReturnValue(doc.indexOf('Label'));
    const click = () => {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, [modifier]: true });
      view.contentDOM.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    };
    click();
    expect(openWiki).toHaveBeenCalledExactlyOnceWith('Note');
    expect(openMarkdown).not.toHaveBeenCalled();
    coords.mockReturnValue(doc.indexOf('https'));
    click();
    expect(openMarkdown).toHaveBeenCalledExactlyOnceWith('https://example.com/path(a)');
    expect(view.state.selection.main.head).toBe(doc.length);
    expect(view.state.doc.toString()).toBe(doc);
  },
);
