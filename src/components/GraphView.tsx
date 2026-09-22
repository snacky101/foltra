import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Maximize2, Minus, Plus } from 'lucide-react';
import { TopicFolderFilter } from './TopicFolderFilter';
import type { GraphMessage } from '../lib/graphLayout.worker';
import type { Settings, Workspace } from '../lib/types';
import type { GraphInput, GraphLayout } from '../lib/graphLayout';
import { graphDocuments } from '../lib/graphDocuments';

export function GraphView({
  workspace,
  openNote,
  openLink,
  updateSettings,
}: {
  workspace: Workspace;
  updateSettings: (patch: Partial<Settings>) => Promise<boolean>;
  openNote: (id: string) => void;
  openLink: (target: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [local, setLocal] = useState(false);
  const [result, setResult] = useState<{ key: string; layout: GraphLayout } | null>(null);
  const [error, setError] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const nodeDrag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const send = (message: GraphMessage) => workerRef.current?.postMessage(message);
  const drag = useRef<{ x: number; y: number; pan: { x: number; y: number } } | null>(null);
  const documents = graphDocuments(workspace);
  const current = documents.notes.find((note) => note.id === selected);
  const open = (id: string) => {
    const note = documents.notes.find((note) => note.id === id);
    if (note?.unresolved) openLink(note.title);
    else if (note) openNote(id);
  };
  const adjacent = new Set(
    documents.links
      .filter((link) => link.source === current?.id || link.target === current?.id)
      .flatMap((link) => [link.source, link.target]),
  );
  const candidates = documents.notes
    .filter((note) => !local || !current || note.id === current.id || adjacent.has(note.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 120);
  const ids = new Set(candidates.map((note) => note.id));
  const input: GraphInput = {
    notes: candidates.map(({ id, title }) => ({ id, title })),
    links: documents.links
      .filter((link) => ids.has(link.source) && ids.has(link.target ?? ''))
      .map(({ source, target }) => ({ source, target }))
      .sort((a, b) => a.source.localeCompare(b.source) || (a.target ?? '').localeCompare(b.target ?? '')),
  };
  // Content edits and selection highlights don't restart the simulation.
  const key = JSON.stringify(input);
  useEffect(() => {
    let active = true;
    setError(false);
    const worker = new Worker(new URL('../lib/graphLayout.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    setZoom(1);
    setPan({ x: 0, y: 0 });
    worker.onmessage = (event: MessageEvent<GraphLayout>) => {
      if (!active) return;
      setResult({ key, layout: event.data });
    };
    worker.onerror = () => {
      if (active) setError(true);
      worker.terminate();
    };
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const start = () =>
      worker.postMessage({ type: 'start', input: JSON.parse(key), reducedMotion: media.matches });
    const visibility = () => worker.postMessage({ type: 'pause', paused: document.hidden });
    start();
    visibility();
    media.addEventListener('change', start);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      active = false;
      workerRef.current = null;
      media.removeEventListener('change', start);
      document.removeEventListener('visibilitychange', visibility);
      worker.terminate();
    };
  }, [key]);
  const graph = result?.key === key ? result.layout : null;
  const nodeMap = useMemo(() => new Map(graph?.nodes.map((node) => [node.id, node]) ?? []), [graph]);
  const activeId = (hovered && nodeMap.has(hovered) ? hovered : null) ?? current?.id ?? null;
  const related = new Set([activeId]);
  for (const edge of graph?.edges ?? []) {
    if (edge.source === activeId || edge.target === activeId) {
      related.add(edge.source);
      related.add(edge.target);
    }
  }
  const bounds = graph?.bounds ?? { x: -420, y: -280, width: 840, height: 560 };
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const camera = useRef({ zoom, pan, cx, cy });
  camera.current = { zoom, pan, cx, cy };
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const matrix = element.getScreenCTM();
      if (!matrix) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      const old = camera.current;
      const delta =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      const next = Math.min(
        4,
        Math.max(0.4, old.zoom * Math.exp(-Math.max(-300, Math.min(300, delta)) * 0.002)),
      );
      const ratio = next / old.zoom;
      const nextPan = {
        x: point.x - old.cx - (point.x - old.cx - old.pan.x) * ratio,
        y: point.y - old.cy - (point.y - old.cy - old.pan.y) * ratio,
      };
      camera.current = { ...old, zoom: next, pan: nextPan };
      setZoom(next);
      setPan(nextPan);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  const textScale = Math.max(1, bounds.width / 840) / zoom;
  const labelBoxes: { left: number; right: number; top: number; bottom: number }[] = [];
  const visibleLabels = new Set<string>();
  // Keep labels legible after fitting; reserve space for the active node first.
  for (const node of [...(graph?.nodes ?? [])].sort(
    (a, b) => Number(b.id === activeId) - Number(a.id === activeId) || b.degree - a.degree,
  )) {
    if ((graph?.nodes.length ?? 0) > 35 && zoom < 1.6 && !related.has(node.id)) continue;
    const box = {
      left: node.x - (node.labelWidth / 2 + 4) * textScale,
      right: node.x + (node.labelWidth / 2 + 4) * textScale,
      top: node.y + node.radius + 4 * textScale,
      bottom: node.y + node.radius + 20 * textScale,
    };
    if (
      labelBoxes.some(
        (other) =>
          box.left < other.right &&
          box.right > other.left &&
          box.top < other.bottom &&
          box.bottom > other.top,
      )
    )
      continue;
    labelBoxes.push(box);
    visibleLabels.add(node.id);
  }
  return (
    <section className="graph-view page-view">
      <div className="eyebrow">FOLLOW THE CONNECTIONS</div>
      <div className="page-heading">
        <h1>지식 그래프</h1>
        <label className="toggle-label">
          <input type="checkbox" checked={local} onChange={(e) => setLocal(e.target.checked)} />
          선택한 노트 주변
        </label>
      </div>
      <p className="page-description">서로 다른 생각 사이에서, 다음 연결을 발견하세요.</p>
      <TopicFolderFilter
        folders={workspace.folders}
        value={workspace.settings.graphFolders ?? { include: [], exclude: [] }}
        setting="graphFolders"
        label="지식 그래프 폴더 범위"
        updateSettings={updateSettings}
      />
      <div className="graph-canvas" aria-busy={!graph && !error}>
        <svg
          ref={svg}
          viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
          role="group"
          aria-label="노트 연결 그래프"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            suppressClick.current = false;
            const node = (e.target as Element).closest('[data-node-id]');
            if (node) {
              nodeDrag.current = {
                id: node.getAttribute('data-node-id')!,
                x: e.clientX,
                y: e.clientY,
                moved: false,
              };
              return;
            }
            e.preventDefault();
            const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(
              e.currentTarget.getScreenCTM()!.inverse(),
            );
            drag.current = { x: point.x, y: point.y, pan };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const moving = nodeDrag.current;
            if (moving) {
              if (Math.hypot(e.clientX - moving.x, e.clientY - moving.y) < 4 && !moving.moved) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              moving.moved = true;
              suppressClick.current = true;
              const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(
                e.currentTarget.getScreenCTM()!.inverse(),
              );
              send({
                type: 'drag',
                id: moving.id,
                x: (point.x - pan.x - cx) / zoom + cx,
                y: (point.y - pan.y - cy) / zoom + cy,
              });
              return;
            }
            if (!drag.current) return;
            const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(
              e.currentTarget.getScreenCTM()!.inverse(),
            );
            setPan({
              x: drag.current.pan.x + point.x - drag.current.x,
              y: drag.current.pan.y + point.y - drag.current.y,
            });
          }}
          onPointerUp={(e) => {
            if (nodeDrag.current && !nodeDrag.current.moved) nodeDrag.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            if (nodeDrag.current?.moved) send({ type: 'release', id: nodeDrag.current.id });
            nodeDrag.current = null;
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            if (nodeDrag.current?.moved) send({ type: 'release', id: nodeDrag.current.id });
            nodeDrag.current = null;
            drag.current = null;
          }}
        >
          <defs>
            <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1" fill="currentColor" opacity=".13" />
            </pattern>
          </defs>
          <rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} fill="url(#dots)" />
          <g
            className="graph-scene"
            transform={`translate(${pan.x} ${pan.y}) translate(${cx} ${cy}) scale(${zoom}) translate(${-cx} ${-cy})`}
          >
            {graph?.edges.map((edge) => {
              const a = nodeMap.get(edge.source)!;
              const b = nodeMap.get(edge.target)!;
              return (
                <line
                  key={`${edge.source}:${edge.target}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={
                    edge.source === activeId || edge.target === activeId
                      ? 'selected-edge'
                      : `graph-edge${activeId ? ' dimmed' : ''}`
                  }
                />
              );
            })}
            {graph?.nodes.map((node) => (
              <g
                key={node.id}
                data-node-id={node.id}
                className={`graph-node${documents.notes.find((note) => note.id === node.id)?.unresolved ? ' unresolved' : ''}${selected === node.id ? ' selected' : ''}${activeId && !related.has(node.id) ? ' dimmed' : ''}`}
                tabIndex={0}
                role="button"
                aria-label={`노트 ${node.title}`}
                onClick={() => {
                  if (!suppressClick.current) setSelected(node.id);
                }}
                onDoubleClick={() => {
                  if (!suppressClick.current) open(node.id);
                }}
                onPointerEnter={() => setHovered(node.id)}
                onPointerLeave={() => setHovered(null)}
                onFocus={() => setHovered(node.id)}
                onBlur={() => setHovered(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') open(node.id);
                  if (e.key === ' ') {
                    e.preventDefault();
                    setSelected(node.id);
                  }
                }}
                transform={`translate(${node.x} ${node.y})`}
              >
                <title>{node.title}</title>
                <circle className="node-halo" r={node.radius + 10} />
                <circle r={node.radius} />
                {visibleLabels.has(node.id) && (
                  <text
                    y={node.radius + 16 * textScale}
                    textAnchor="middle"
                    style={{ fontSize: 11 * textScale, strokeWidth: 3 * textScale }}
                  >
                    {node.label}
                  </text>
                )}
              </g>
            ))}
          </g>
        </svg>
        {(!graph || !graph.nodes.length) && (
          <p className="graph-empty" role="status">
            {error
              ? '그래프를 배치하지 못했습니다. 다른 화면으로 이동한 뒤 다시 열어주세요.'
              : !graph
                ? '연결을 정리하고 있습니다…'
                : '노트를 만들면 연결을 살펴볼 수 있어요.'}
          </p>
        )}
        <div className="graph-zoom">
          <button aria-label="축소" onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))}>
            <Minus size={16} />
          </button>
          <button
            aria-label="전체 그래프 맞추기"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            <Maximize2 size={15} />
          </button>
          <button aria-label="확대" onClick={() => setZoom((z) => Math.min(4, z + 0.2))}>
            <Plus size={16} />
          </button>
        </div>
        <span className="graph-legend">
          <i />
          노트{' '}
          <span>
            {graph?.nodes.length ?? 0} / {documents.notes.length} 표시
          </span>
        </span>
      </div>
      {current ? (
        <button className="graph-selection" onClick={() => open(current.id)}>
          <strong>{current.title}</strong>
          <span>
            {current.unresolved
              ? '미생성 노트 · 클릭하여 만들기'
              : `${nodeMap.get(current.id)?.degree ?? 0} connections`}
          </span>
          <ArrowUpRight size={17} />
        </button>
      ) : (
        <p className="graph-help">
          휠로 확대·축소하고 배경을 끌어 이동하세요. 노드를 끌면 주변 연결도 따라 움직입니다. 두 번 클릭하거나
          Enter로 노트를 엽니다.
        </p>
      )}
    </section>
  );
}
