import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';

export interface GraphInput {
  notes: { id: string; title: string }[];
  links: { source: string; target: string | null }[];
}
export interface GraphNode {
  id: string;
  title: string;
  label: string;
  labelWidth: number;
  degree: number;
  radius: number;
  x: number;
  y: number;
  fx?: number | null;
  fy?: number | null;
}
export interface GraphLayout {
  nodes: GraphNode[];
  edges: { source: string; target: string }[];
  bounds: { x: number; y: number; width: number; height: number };
}

// Runs in a worker: d3 mutates only these disposable layout objects, never vault data.
export function createGraphSimulation(input: GraphInput) {
  const nodes: GraphNode[] = input.notes
    .slice(0, 120)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((note, index) => {
      const characters = Array.from(note.title);
      const label = characters.slice(0, 20).join('') + (characters.length > 20 ? '…' : '');
      const labelWidth = Array.from(label).reduce((sum, ch) => sum + (ch.charCodeAt(0) > 255 ? 11 : 6.5), 0);
      return {
        ...note,
        label,
        labelWidth,
        degree: 0,
        radius: 5,
        x: Math.cos(index * 2.399963) * Math.sqrt(index) * 40,
        y: Math.sin(index * 2.399963) * Math.sqrt(index) * 40,
      };
    });
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const unique = new Map<string, { source: string; target: string }>();
  for (const link of input.links) {
    if (!link.target || link.source === link.target || !nodeMap.has(link.source) || !nodeMap.has(link.target))
      continue;
    const [source, target] = [link.source, link.target].sort();
    unique.set(JSON.stringify([source, target]), { source, target });
  }
  const edges = [...unique.values()].sort(
    (a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
  );
  for (const edge of edges) {
    nodeMap.get(edge.source)!.degree++;
    nodeMap.get(edge.target)!.degree++;
  }
  for (const node of nodes) node.radius = 5 + Math.min(node.degree, 8);
  const simulation = forceSimulation(nodes)
    .stop()
    .force('repel', forceManyBody<GraphNode>().strength(-260).distanceMin(20))
    .force(
      'link',
      forceLink<GraphNode, { source: string; target: string }>(edges.map((edge) => ({ ...edge })))
        .id((node) => node.id)
        .distance(120)
        .strength(0.12),
    )
    .force(
      'collision',
      forceCollide<GraphNode>((node) => Math.max(node.radius + 18, node.labelWidth / 2 + 10)).iterations(3),
    )
    .force('x', forceX(0).strength(0.012))
    .force('y', forceY(0).strength(0.012))
    .velocityDecay(0.45);
  return { nodes, edges, simulation };
}

export function graphSnapshot(nodes: GraphNode[], edges: GraphLayout['edges']): GraphLayout {
  const left = Math.min(0, ...nodes.map((n) => n.x - Math.max(n.labelWidth / 2, n.radius + 10))) - 40;
  const right = Math.max(0, ...nodes.map((n) => n.x + Math.max(n.labelWidth / 2, n.radius + 10))) + 40;
  const top = Math.min(0, ...nodes.map((n) => n.y - n.radius - 10)) - 40;
  const bottom = Math.max(0, ...nodes.map((n) => n.y + n.radius + 30)) + 60;
  const scale = Math.max((right - left) / 840, (bottom - top) / 560, 1);
  return {
    nodes: nodes.map((node) => ({ ...node })),
    edges,
    bounds: {
      x: (left + right - 840 * scale) / 2,
      y: (top + bottom - 560 * scale) / 2,
      width: 840 * scale,
      height: 560 * scale,
    },
  };
}

export function layoutGraph(input: GraphInput): GraphLayout {
  const { nodes, edges, simulation } = createGraphSimulation(input);
  simulation.tick(300);
  return graphSnapshot(nodes, edges);
}
