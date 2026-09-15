import { useEffect, useRef, useImperativeHandle, forwardRef, type RefObject } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine, panels } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { vim, getCM } from '@replit/codemirror-vim';
import { GFM } from '@lezer/markdown';
import { livePreviewExtension, refreshLivePreview } from '../lib/livePreview';
import { bindVimCommands } from '../lib/vimCommands';
import { bindVimInput } from '../lib/vimInput';
import type { NoteCommand } from '../lib/noteCommands';
import type { Workspace } from '../lib/types';

export interface EditorHandle {
  focus: () => void;
  insert: (text: string) => void;
  jump: (line: number) => void;
}
interface Props {
  value: string;
  vimEnabled: boolean;
  livePreview: boolean;
  workspace: Workspace;
  openNote: (id: string) => void;
  commandLineHost: RefObject<HTMLDivElement | null>;
  slash: boolean;
  onChange: (value: string) => void;
  onMode: (mode: string) => void;
  onSlash: () => void;
  onNoteCommand: (command: NoteCommand, force: boolean) => Promise<void>;
  onError: (error: unknown) => void;
  onReady?: () => void;
}

export const Editor = forwardRef<EditorHandle, Props>(function Editor(props, ref) {
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const vimConfig = useRef(new Compartment());
  const previewConfig = useRef(new Compartment());
  const external = useRef(false);
  useImperativeHandle(ref, () => ({
    focus: () => view.current?.focus(),
    insert: (text) => {
      const editor = view.current;
      if (!editor) return;
      editor.dispatch(editor.state.replaceSelection(text));
      editor.focus();
    },
    jump: (number) => {
      const editor = view.current;
      if (!editor) return;
      const line = editor.state.doc.line(Math.max(1, Math.min(number, editor.state.doc.lines)));
      editor.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
      editor.focus();
    },
  }));
  useEffect(() => {
    const editor = new EditorView({
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          vimConfig.current.of(latest.current.vimEnabled ? vim() : []),
          panels({ bottomContainer: latest.current.commandLineHost.current ?? undefined }),
          history(),
          drawSelection(),
          highlightActiveLine(),
          markdown({ extensions: [GFM] }),
          previewConfig.current.of(
            latest.current.livePreview ? livePreviewExtension(() => latest.current) : [],
          ),
          syntaxHighlighting(defaultHighlightStyle),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': '노트 본문', spellcheck: 'false' }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !external.current) latest.current.onChange(update.state.doc.toString());
            const cm = getCM(update.view);
            const vimState = cm?.state.vim;
            latest.current.onMode(
              !latest.current.vimEnabled
                ? 'EDIT'
                : vimState?.insertMode
                  ? 'INSERT'
                  : vimState?.visualMode
                    ? 'VISUAL'
                    : 'NORMAL',
            );
          }),
          EditorView.domEventHandlers({
            keydown(event, editor) {
              if (event.isComposing || !latest.current.slash || event.key !== '/') return false;
              const state = getCM(editor)?.state.vim;
              if (latest.current.vimEnabled && !state?.insertMode) return false;
              const cursor = editor.state.selection.main.head;
              const before = editor.state.doc.sliceString(editor.state.doc.lineAt(cursor).from, cursor);
              if (!before.trim()) {
                event.preventDefault();
                latest.current.onSlash();
                return true;
              }
              return false;
            },
          }),
          EditorView.theme({
            '&': { background: 'transparent', fontSize: '16px' },
            '.cm-content': { fontFamily: 'var(--body-font)', lineHeight: '1.95', padding: '16px 0 160px' },
            '.cm-line': { padding: '0' },
            '.cm-scroller': { overflow: 'visible' },
            '.cm-focused': { outline: 'none' },
            '.cm-cursor': { borderLeftColor: 'var(--accent)' },
            '.cm-activeLine': { background: 'transparent' },
            '&.cm-focused': { outline: 'none' },
            // Vim's highest-priority theme supplies a red cursor and an unfocused outline.
            // Scope to its layer so our theme wins without changing selection rendering.
            '.cm-vimCursorLayer .cm-fat-cursor': {
              background: 'color-mix(in srgb, var(--accent) 35%, transparent)',
              outline: 'none',
            },
            '&:not(.cm-focused) .cm-vimCursorLayer': { display: 'none' },
            '.cm-selectionBackground': { background: 'var(--selection) !important' },
          }),
        ],
      }),
      parent: parent.current!,
    });
    view.current = editor;
    const unbindInput = bindVimInput(editor);
    latest.current.onMode(latest.current.vimEnabled ? 'NORMAL' : 'EDIT');
    // Report readiness after mount effects settle; StrictMode may recreate this view first.
    const readyFrame = window.requestAnimationFrame(() => latest.current.onReady?.());
    return () => {
      window.cancelAnimationFrame(readyFrame);
      unbindInput();
      editor.destroy();
      view.current = null;
    };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== props.value) {
      external.current = true;
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: props.value } });
      external.current = false;
    }
  }, [props.value]);
  useEffect(() => {
    view.current?.dispatch({
      effects: previewConfig.current.reconfigure(
        props.livePreview ? livePreviewExtension(() => latest.current) : [],
      ),
    });
  }, [props.livePreview]);
  useEffect(() => {
    if (props.livePreview) view.current?.dispatch({ effects: refreshLivePreview.of(null) });
  }, [props.workspace]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({ effects: vimConfig.current.reconfigure(props.vimEnabled ? vim() : []) });
    latest.current.onMode(props.vimEnabled ? 'NORMAL' : 'EDIT');
    const cm = getCM(editor);
    const unbind = cm
      ? bindVimCommands(cm, {
          run: (command, force) => latest.current.onNoteCommand(command, force),
          error: (error) => latest.current.onError(error),
        })
      : undefined;
    const modeChanged = (event: { mode: string }) => latest.current.onMode(event.mode.toUpperCase());
    cm?.on('vim-mode-change', modeChanged);
    return () => {
      unbind?.();
      cm?.off('vim-mode-change', modeChanged);
    };
  }, [props.vimEnabled]);
  return <div className="editor" ref={parent} />;
});
