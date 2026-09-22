import {
  createGraphSimulation,
  graphSnapshot,
  layoutGraph,
  type GraphInput,
  type GraphLayout,
} from './graphLayout';

export type GraphMessage =
  | { type: 'start'; input: GraphInput; reducedMotion: boolean }
  | { type: 'drag'; id: string; x: number; y: number }
  | { type: 'release'; id: string }
  | { type: 'pause'; paused: boolean };

let graph: ReturnType<typeof createGraphSimulation> | undefined;
let bounds: GraphLayout['bounds'];
let timer: ReturnType<typeof setTimeout> | undefined;
let reducedMotion = false;
let paused = false;
const publish = () => {
  if (!graph) return;
  const layout = graphSnapshot(graph.nodes, graph.edges);
  // Stable camera while forces settle; moving bounds would make zoom and dragging jump.
  self.postMessage({ ...layout, bounds });
};
const tick = () => {
  timer = undefined;
  if (!graph || paused) return;
  graph.simulation.tick(reducedMotion ? 300 : 3);
  publish();
  if (graph.simulation.alpha() > graph.simulation.alphaMin()) timer = setTimeout(tick, 32);
};
const wake = () => {
  if (timer === undefined && !paused) tick();
};
self.onmessage = (event: MessageEvent<GraphMessage>) => {
  const message = event.data;
  if (message.type === 'start') {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    reducedMotion = message.reducedMotion;
    bounds = layoutGraph(message.input).bounds;
    graph = createGraphSimulation(message.input);
    wake();
  } else if (message.type === 'pause') {
    paused = message.paused;
    if (!paused) wake();
  } else if (graph) {
    const node = graph.nodes.find((node) => node.id === message.id);
    if (!node) return;
    if (message.type === 'drag') {
      node.fx = node.x = message.x;
      node.fy = node.y = message.y;
    } else {
      node.fx = null;
      node.fy = null;
    }
    graph.simulation.alpha(Math.max(graph.simulation.alpha(), 0.3));
    wake();
  }
};
