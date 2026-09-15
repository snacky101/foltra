import { describe, expect, it } from 'vitest';
import { layoutGraph, type GraphInput } from './graphLayout';

const notes = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `n${String(i).padStart(3, '0')}`,
    title: `연결된 생각 ${i}`,
  }));
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe('force graph layout', () => {
  it('draws unique visible connections without mutating source notes or links', () => {
    const input: GraphInput = {
      notes: notes(2),
      links: [
        { source: 'n000', target: 'n001' },
        { source: 'n000', target: 'n001' },
        { source: 'n001', target: 'n000' },
        { source: 'n000', target: 'n000' },
        { source: 'row', target: 'n000' },
        { source: 'n000', target: null },
      ],
    };
    const before = structuredClone(input);
    const graph = layoutGraph(input);
    expect(input).toEqual(before);
    expect(graph.edges).toEqual([{ source: 'n000', target: 'n001' }]);
    expect(graph.nodes.map((node) => node.degree)).toEqual([1, 1]);
  });

  it('places connected groups closer than unrelated groups', () => {
    const input: GraphInput = { notes: notes(12), links: [] };
    for (let i = 0; i < 12; i++)
      for (let j = i + 1; j < 12; j++) {
        if (Math.floor(i / 4) === Math.floor(j / 4))
          input.links.push({ source: input.notes[i].id, target: input.notes[j].id });
      }
    const graph = layoutGraph(input);
    const linked: number[] = [],
      unrelated: number[] = [];
    for (let i = 0; i < 12; i++)
      for (let j = i + 1; j < 12; j++) {
        (Math.floor(i / 4) === Math.floor(j / 4) ? linked : unrelated).push(
          distance(graph.nodes[i], graph.nodes[j]),
        );
      }
    const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    expect(average(linked)).toBeLessThan(average(unrelated) * 0.65);
  });

  it('keeps 120 crowded nodes apart and includes their labels in the fitted view', () => {
    const input: GraphInput = { notes: notes(120), links: [] };
    for (const node of input.notes.slice(1)) input.links.push({ source: input.notes[0].id, target: node.id });
    const graph = layoutGraph(input);
    for (let i = 0; i < graph.nodes.length; i++) {
      const a = graph.nodes[i];
      expect(Number.isFinite(a.x) && Number.isFinite(a.y)).toBe(true);
      expect(a.x - a.labelWidth / 2).toBeGreaterThan(graph.bounds.x);
      expect(a.x + a.labelWidth / 2).toBeLessThan(graph.bounds.x + graph.bounds.width);
      expect(a.y - a.radius).toBeGreaterThan(graph.bounds.y);
      expect(a.y + a.radius + 30).toBeLessThan(graph.bounds.y + graph.bounds.height);
      for (const b of graph.nodes.slice(i + 1))
        expect(distance(a, b)).toBeGreaterThan(a.radius + b.radius + 8);
    }
  });

  it('is deterministic across snapshot ordering changes', () => {
    const input: GraphInput = {
      notes: notes(8),
      links: [
        { source: 'n000', target: 'n005' },
        { source: 'n001', target: 'n004' },
      ],
    };
    const first = layoutGraph(input);
    expect(layoutGraph({ notes: [...input.notes].reverse(), links: [...input.links].reverse() })).toEqual(
      first,
    );
  });

  it('handles empty and isolated notes and bounds the displayed graph', () => {
    expect(layoutGraph({ notes: [], links: [] })).toEqual({
      nodes: [],
      edges: [],
      bounds: { x: -420, y: -270, width: 840, height: 560 },
    });
    const graph = layoutGraph({ notes: notes(130), links: [] });
    expect(graph.nodes).toHaveLength(120);
    expect(
      graph.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y) && node.degree === 0),
    ).toBe(true);
  });
});
