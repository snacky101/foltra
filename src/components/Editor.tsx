import { editorHighlightStyle } from '../lib/codeHighlighting';
import { fontFamilyStack } from '../lib/fontFamily';
import type { CSSProperties } from 'react';
import { useContext } from 'react';
import { TagNavigation } from '../lib/tagNavigation';
import { PluginCompletionContext } from '../lib/pluginCompletionContext';
import { pluginEditorSnapshot, applyPluginEditorEdit } from '../lib/pluginEditor';
import type { PluginEditorSnapshot } from '../lib/pluginTypes';
import { tags } from '@lezer/highlight';
import { useEffect, useLayoutEffect, useRef, useImperativeHandle, forwardRef, type RefObject } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine, panels } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import { frontmatterRange } from '../lib/frontmatter';
import { addFrontmatterProperty, frontmatterPanelState } from '../lib/livePreviewFrontmatter';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { vim, getCM } from '@replit/codemirror-vim';
import { codeLanguage } from '../lib/codeLanguages';
import { GFM } from '@lezer/markdown';
import { livePreviewExtension, refreshLivePreview } from '../lib/livePreview';
import { bindVimCommands } from '../lib/vimCommands';
import { bindVimKeybindings, type VimBinding } from '../lib/vimKeybindings';
import { bindVimInput } from '../lib/vimInput';
import { noteCompletionExtension } from '../lib/noteCompletion';
import { followEditorLink, editorLinkNavigation } from '../lib/wikiLinkNavigation';
import { openExternalLink } from '../lib/openExternalLink';
import { editorCursorExtension, refreshEditorCursor } from '../lib/editorCursor';
import { editorLineNumbers } from '../lib/lineNumbers';
import { markdownEditing } from '../lib/markdownEditing';
import { cycleMarkdownTask } from '../lib/markdownTasks';
import { toggleMarkdownFormat, type MarkdownFormat } from '../lib/markdownFormatting';
import { imagePasteExtension } from '../lib/imagePaste';
import {
  captureEditorLocation,
  restoreEditorLocation,
  readEditorLocation,
  trackEditorLocation,
  type EditorLocation,
} from '../lib/editorLocation';
import { externalDocumentChange } from '../lib/editorDocument';
import type { NoteCommand } from '../lib/noteCommands';
import type { Workspace } from '../lib/types';

const previewHighlightStyle = HighlightStyle.define(
  editorHighlightStyle.specs.map((spec) =>
    spec.tag === tags.heading
      ? { tag: tags.heading, fontWeight: 'inherit', textDecoration: 'none' }
      : spec.tag === tags.strong
        ? { tag: tags.strong, fontWeight: '600' }
        : spec,
  ),
);

export interface EditorHandle {
  pluginSnapshot: () => PluginEditorSnapshot | null;
  applyPluginEdit: (snapshot: PluginEditorSnapshot, text: string) => boolean;
  focus: () => void;
  insert: (text: string) => void;
  editFrontmatter: () => void;
  addFrontmatterProperty: () => void;
  cycleTask: () => void;
  format: (format: MarkdownFormat) => void;
  jump: (line: number) => void;
  followLink: (createIfMissing?: boolean) => void;
  getLocation: () => EditorLocation | null;
  restoreLocation: (location: EditorLocation) => void;
}
interface Props {
  noteId: string;
  value: string;
  hidden?: boolean;
  vimEnabled: boolean;
  livePreview: boolean;
  workspace: Workspace;
  openNote: (id: string) => void;
  openLink: (target: string, createIfMissing?: boolean) => void;
  vimBindings: VimBinding[];
  onCommand: (id: string) => void;
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
  const openTag = useContext(TagNavigation);
  const complete = useContext(PluginCompletionContext);
  const latest = useRef({ ...props, openTag, openMarkdownLink, complete });
  latest.current = { ...props, openTag, openMarkdownLink, complete };
  function openMarkdownLink(target: string) {
    void openExternalLink(target).catch((error) => latest.current.onError(error));
  }
  const vimConfig = useRef(new Compartment());
  const previewConfig = useRef(new Compartment());
  const highlightConfig = useRef(new Compartment());
  const cursorConfig = useRef(new Compartment());
  const lineNumberConfig = useRef(new Compartment());
  const external = useRef(false);
  const location = useRef<ReturnType<typeof trackEditorLocation> | null>(null);
  useImperativeHandle(ref, () => ({
    pluginSnapshot: () => pluginEditorSnapshot(view.current, latest.current.noteId),
    applyPluginEdit: (snapshot, text) =>
      applyPluginEditorEdit(view.current, latest.current.noteId, snapshot, text),
    focus: () => view.current?.focus(),
    getLocation: () => (view.current ? captureEditorLocation(view.current) : null),
    restoreLocation: (saved) => {
      if (!view.current) return;
      location.current?.restoreScroll();
      restoreEditorLocation(view.current, saved);
    },
    followLink: (createIfMissing = true) => {
      const editor = view.current;
      if (editor && !editor.composing)
        followEditorLink(editor.state, {
          openWiki: (target) => latest.current.openLink(target, createIfMissing),
          openMarkdown: (target) => latest.current.openMarkdownLink(target),
        });
    },
    insert: (text) => {
      const editor = view.current;
      if (!editor) return;
      editor.dispatch(editor.state.replaceSelection(text));
      editor.focus();
    },
    editFrontmatter: () => {
      const editor = view.current;
      if (!editor || editor.composing) return;
      if (!frontmatterRange(editor.state.doc.toString()))
        editor.dispatch({ changes: { from: 0, insert: '---\ntags: []\n---\n\n' }, userEvent: 'input' });
      editor.dispatch({ selection: { anchor: editor.state.doc.line(2).from }, scrollIntoView: true });
      editor.focus();
    },
    addFrontmatterProperty: () => {
      if (view.current) addFrontmatterProperty(view.current);
    },
    cycleTask: () => {
      const editor = view.current;
      if (!editor || !editor.hasFocus || latest.current.hidden || editor.compositionStarted) return;
      if (cycleMarkdownTask(editor)) editor.focus();
    },
    format: (format) => {
      const editor = view.current;
      if (!editor || !editor.hasFocus || latest.current.hidden || editor.compositionStarted) return;
      if (toggleMarkdownFormat(editor, format)) editor.focus();
    },
    jump: (number) => {
      const editor = view.current;
      if (!editor) return;
      const line = editor.state.doc.line(Math.max(1, Math.min(number, editor.state.doc.lines)));
      editor.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
      editor.focus();
    },
  }));
  useLayoutEffect(() => {
    const locationKey = `foltra:editor-location:${latest.current.workspace.vault.id}:${latest.current.noteId}`;
    const savedLocation = readEditorLocation(locationKey, latest.current.value.length);
    const editor = new EditorView({
      state: EditorState.create({
        doc: latest.current.value,
        selection: savedLocation ? { anchor: savedLocation.anchor, head: savedLocation.head } : undefined,
        extensions: [
          vimConfig.current.of(latest.current.vimEnabled ? vim() : []),
          panels({ bottomContainer: latest.current.commandLineHost.current ?? undefined }),
          history(),
          frontmatterPanelState,
          drawSelection(),
          cursorConfig.current.of(editorCursorExtension(latest.current.workspace.settings)),
          lineNumberConfig.current.of(editorLineNumbers(latest.current.workspace.settings.lineNumbers)),
          highlightActiveLine(),
          yamlFrontmatter({
            content: markdown({
              extensions: [GFM],
              addKeymap: false,
              codeLanguages: (name) => codeLanguage(name, true),
            }),
          }),
          markdownEditing,
          imagePasteExtension(() => ({
            vault: latest.current.workspace.path,
            onError: latest.current.onError,
          })),
          noteCompletionExtension(
            () => latest.current.workspace,
            (error) => latest.current.onError(error),
            () => latest.current.complete,
          ),
          editorLinkNavigation({
            openWiki: (target) => latest.current.openLink(target),
            openMarkdown: (target) => latest.current.openMarkdownLink(target),
          }),
          previewConfig.current.of(
            latest.current.livePreview ? livePreviewExtension(() => latest.current) : [],
          ),
          highlightConfig.current.of(
            syntaxHighlighting(latest.current.livePreview ? previewHighlightStyle : editorHighlightStyle),
          ),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          // WebKit gates macOS Text Replacements on these attributes. CodeMirror's
          // code-editor defaults disable both, including user-defined shortcuts.
          EditorView.contentAttributes.of({
            'aria-label': '노트 본문',
            spellcheck: 'true',
            autocorrect: 'on',
          }),
          EditorView.updateListener.of((update) => {
            if (update.selectionSet || update.docChanged) location.current?.changed();
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
            '.cm-content': {
              fontFamily: 'var(--editor-font-family, var(--body-font))',
              lineHeight: '1.95',
              padding: '16px 0 160px',
            },
            '.cm-line': { padding: '0' },
            '.cm-scroller': { overflow: 'visible' },
            '.cm-focused': { outline: 'none' },
            '.cm-cursor': { borderLeftColor: 'var(--accent)' },
            '.cm-activeLine': { background: 'transparent' },
            '.cm-gutters': {
              position: 'absolute',
              top: '0',
              insetInlineStart: 'auto',
              insetInlineEnd: 'calc(100% + var(--line-number-gap, 24px))',
              background: 'transparent',
              border: 'none',
              color: 'var(--muted)',
              fontFamily: 'var(--mono-font)',
              fontSize: '12px',
              lineHeight: '31.2px',
            },
            '.cm-lineNumbers .cm-gutterElement': { padding: '0', minWidth: '2ch' },
            '.cm-activeLineGutter': { background: 'transparent', color: 'var(--accent)', fontWeight: '600' },
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
    location.current = trackEditorLocation(editor, locationKey);
    const unbindInput = bindVimInput(editor);
    latest.current.onMode(latest.current.vimEnabled ? 'NORMAL' : 'EDIT');
    return () => {
      unbindInput();
      location.current?.destroy();
      location.current = null;
      editor.destroy();
      view.current = null;
    };
  }, []);
  useEffect(() => {
    if (props.hidden) return;
    // Reading mode retains the editor and its undo history; measure after it becomes visible.
    const frame = requestAnimationFrame(() => {
      location.current?.restoreScroll();
      view.current?.requestMeasure();
      latest.current.onReady?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [props.hidden]);
  useLayoutEffect(() => {
    const editor = view.current;
    const change = editor && externalDocumentChange(editor.state, props.value);
    if (editor && change) {
      external.current = true;
      try {
        editor.dispatch(change);
      } finally {
        external.current = false;
      }
    }
  }, [props.value]);
  useEffect(() => {
    view.current?.dispatch({
      effects: [
        previewConfig.current.reconfigure(
          props.livePreview ? livePreviewExtension(() => latest.current, view.current.hasFocus) : [],
        ),
        highlightConfig.current.reconfigure(
          syntaxHighlighting(props.livePreview ? previewHighlightStyle : editorHighlightStyle),
        ),
      ],
    });
  }, [props.livePreview]);
  useEffect(() => {
    view.current?.dispatch({
      effects: lineNumberConfig.current.reconfigure(editorLineNumbers(props.workspace.settings.lineNumbers)),
    });
  }, [props.workspace.settings.lineNumbers]);
  useLayoutEffect(() => {
    view.current?.requestMeasure();
  }, [props.workspace.settings.editorFontFamily]);
  useEffect(() => {
    view.current?.dispatch({
      effects: cursorConfig.current.reconfigure(editorCursorExtension(props.workspace.settings)),
    });
  }, [
    props.workspace.settings.cursorShape,
    props.workspace.settings.cursorFollowVim,
    props.workspace.settings.cursorBlink,
    props.workspace.settings.cursorBlinkRate,
    props.workspace.settings.cursorAnimation,
  ]);
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
    const modeChanged = (event: { mode: string }) => {
      latest.current.onMode(event.mode.toUpperCase());
      refreshEditorCursor(editor);
    };
    cm?.on('vim-mode-change', modeChanged);
    return () => {
      unbind?.();
      cm?.off('vim-mode-change', modeChanged);
    };
  }, [props.vimEnabled]);
  const vimBindingKey = JSON.stringify(props.vimBindings);
  useEffect(() => {
    const cm = view.current && getCM(view.current);
    if (!cm || !props.vimEnabled) return;
    return bindVimKeybindings(cm, latest.current.vimBindings, (id) => latest.current.onCommand(id));
  }, [props.vimEnabled, vimBindingKey]);
  return (
    <div
      className="editor"
      ref={parent}
      style={
        {
          '--editor-font-family': fontFamilyStack(props.workspace.settings.editorFontFamily),
        } as CSSProperties
      }
    />
  );
});
