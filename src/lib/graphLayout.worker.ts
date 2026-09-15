import { layoutGraph, type GraphInput } from './graphLayout';

self.onmessage = (event: MessageEvent<GraphInput>) => {
  self.postMessage(layoutGraph(event.data));
};
