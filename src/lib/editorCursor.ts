import { Facet, findClusterBreak } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { getCM } from '@replit/codemirror-vim';
import { cursorTrail, followCursor, type CursorPoint, type CursorRect } from './cursorMotion';
import { cursorShapeForMode, type CursorSettings } from './cursorAppearance';
import type { Settings } from './types';

const preferences = Facet.define<CursorSettings, CursorSettings>({
  combine: (values) =>
    values[0] ?? {
      cursorShape: 'bar',
      cursorFollowVim: true,
      cursorBlink: 'blink',
      cursorBlinkRate: 600,
      cursorAnimation: 'none',
    },
});
interface MeasuredCursor extends CursorRect {
  shape: Settings['cursorShape'];
}

class EditorCursor {
  private layer = document.createElement('div');
  private cursor = document.createElement('div');
  private svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private trail = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private target: MeasuredCursor | null = null;
  private head: CursorPoint | null = null;
  private tail: CursorPoint | null = null;
  private frame = 0;
  private lastTime = 0;
  private composing = false;
  private snap = true;
  private destroyed = false;
  private measureRequest = {
    read: () => this.measure(),
    write: (rect: MeasuredCursor | null) => this.move(rect),
  };

  constructor(private view: EditorView) {
    this.layer.className = 'foltra-cursor-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    this.cursor.className = 'foltra-cursor';
    this.svg.append(this.trail);
    this.layer.append(this.svg, this.cursor);
    view.scrollDOM.append(this.layer);
    this.reducedMotion.addEventListener('change', this.reset);
    this.schedule();
  }

  schedule() {
    if (!this.destroyed) this.view.requestMeasure(this.measureRequest);
  }

  reset = () => {
    this.snap = true;
    this.cursor.classList.remove('is-idle');
    this.schedule();
  };

  update(update: ViewUpdate) {
    if (update.startState.facet(preferences) !== update.state.facet(preferences)) this.snap = true;
    if (update.selectionSet || update.docChanged || update.focusChanged)
      this.cursor.classList.remove('is-idle');
    if (update.focusChanged && !this.view.hasFocus) this.hide();
    // Measure after decorations/layout settle, never read layout during a transaction.
    if (
      update.selectionSet ||
      update.docChanged ||
      update.geometryChanged ||
      update.viewportChanged ||
      update.focusChanged ||
      update.transactions.length
    ) {
      this.schedule();
    }
  }

  composition(active: boolean) {
    this.composing = active;
    if (active) this.hide();
    this.reset();
  }

  private measure(): MeasuredCursor | null {
    const { view } = this;
    const settings = view.state.facet(preferences);
    if (!view.hasFocus || view.composing || this.composing || view.state.selection.ranges.length !== 1)
      return null;
    const cm = getCM(view);
    const vim = cm?.state.vim;
    const normal = !!vim && (!vim.insertMode || !!cm?.state.overwrite);
    const range = view.state.selection.main;
    if (!range.empty && !normal) return null;
    let head = range.head;
    // Vim's forward visual selection includes the character before its head.
    if (normal && range.anchor < head && view.state.sliceDoc(head, head + 1) !== '\n') {
      const line = view.state.doc.lineAt(head);
      head = line.from + findClusterBreak(line.text, head - line.from, false);
    }
    const caret = view.coordsAtPos(head, range.assoc || 1);
    if (!caret) return null;
    const shape = cursorShapeForMode(
      settings,
      !vim ? 'edit' : cm?.state.overwrite ? 'replace' : normal ? 'normal' : 'insert',
    );
    const char = shape === 'bar' ? null : view.coordsForChar(head);
    const base = view.scrollDOM.getBoundingClientRect();
    const width =
      shape === 'bar'
        ? 2
        : char
          ? Math.max(2, (char.right - char.left) / view.scaleX)
          : view.defaultCharacterWidth;
    const height = shape === 'underline' ? 2 : (caret.bottom - caret.top) / view.scaleY;
    return {
      shape,
      x: ((char?.left ?? caret.left) - base.left) / view.scaleX + view.scrollDOM.scrollLeft,
      y:
        (caret.top - base.top) / view.scaleY +
        view.scrollDOM.scrollTop +
        (shape === 'underline' ? (caret.bottom - caret.top) / view.scaleY - height : 0),
      width,
      height,
    };
  }

  private move(rect: MeasuredCursor | null) {
    if (this.destroyed) return;
    if (!rect) {
      this.hide();
      return;
    }
    const settings = this.view.state.facet(preferences);
    const snap =
      this.snap ||
      !this.target ||
      this.target.shape !== rect.shape ||
      this.reducedMotion.matches ||
      settings.cursorAnimation === 'none';
    this.snap = false;
    this.target = rect;
    this.view.dom.classList.add('cm-foltra-cursor-active');
    this.layer.hidden = false;
    this.cursor.dataset.shape = rect.shape;
    this.cursor.dataset.blink = settings.cursorBlink;
    this.cursor.style.setProperty('--cursor-blink-duration', `${settings.cursorBlinkRate * 2}ms`);
    if (snap || !this.head || !this.tail) {
      this.stop();
      this.head = this.tail = { x: rect.x, y: rect.y };
      this.render();
    } else if ((this.head.x !== rect.x || this.head.y !== rect.y) && !this.frame) {
      this.lastTime = performance.now();
      this.cursor.classList.remove('is-idle');
      this.frame = requestAnimationFrame(this.animate);
    } else {
      this.render();
      if (!this.frame) this.cursor.classList.add('is-idle');
    }
  }

  private animate = (time: number) => {
    this.frame = 0;
    if (!this.target || !this.head || !this.tail) return;
    const elapsed = time - this.lastTime;
    this.lastTime = time;
    this.head = followCursor(this.head, this.target, elapsed, 28);
    this.tail = followCursor(this.tail, this.target, elapsed, 65);
    const smear = this.view.state.facet(preferences).cursorAnimation === 'smear';
    const moving =
      this.head.x !== this.target.x ||
      this.head.y !== this.target.y ||
      (smear && (this.tail.x !== this.target.x || this.tail.y !== this.target.y));
    this.render();
    if (moving) this.frame = requestAnimationFrame(this.animate);
    else this.cursor.classList.add('is-idle');
  };

  private render() {
    if (!this.target || !this.head || !this.tail) return;
    const { width, height } = this.target;
    this.cursor.style.transform = `translate(${this.head.x}px, ${this.head.y}px)`;
    this.cursor.style.width = `${width}px`;
    this.cursor.style.height = `${height}px`;
    this.trail.setAttribute(
      'points',
      this.view.state.facet(preferences).cursorAnimation === 'smear' && !this.reducedMotion.matches
        ? cursorTrail({ ...this.head, width, height }, this.tail)
        : '',
    );
  }

  private stop() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.cursor.classList.add('is-idle');
  }

  hide() {
    this.stop();
    this.target = this.head = this.tail = null;
    this.layer.hidden = true;
    this.trail.setAttribute('points', '');
    this.view.dom.classList.remove('cm-foltra-cursor-active');
  }

  destroy() {
    this.destroyed = true;
    this.hide();
    this.reducedMotion.removeEventListener('change', this.reset);
    this.layer.remove();
  }
}

const cursorPlugin = ViewPlugin.fromClass(EditorCursor, {
  eventObservers: {
    compositionstart() {
      this.composition(true);
    },
    compositionend() {
      this.composition(false);
    },
    scroll() {
      this.reset();
    },
    blur() {
      this.hide();
    },
  },
});

export function refreshEditorCursor(view: EditorView) {
  view.plugin(cursorPlugin)?.reset();
}

export function editorCursorExtension(settings: CursorSettings) {
  return [preferences.of(settings), cursorPlugin];
}
