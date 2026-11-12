import { FlowEdge, FlowNode, GraphChunk } from 'ngx-node-flow';

/** World px per degree; lots are ~10 m, so this spreads them ~20-30 px/m apart. */
const SCALE = 3_000_000;
const COS_LAT = Math.cos((37.77 * Math.PI) / 180);

interface Parcel {
  properties: { BLKLOT: string; BLOCK_NUM: string;STREET: string | null; ST_TYPE: string | null; FROM_ST: string | null };
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] } | null;
}

/**
 * Streams a line-delimited GeoJSON FeatureCollection (one Feature per line, as
 * giant.json is) into graph chunks: one node per parcel at its centroid, and
 * lots of the same block chained in file order. Parcels without geometry are skipped.
 */
export async function* geojsonGraph(body: ReadableStream<BufferSource>, chunkSize: number): AsyncGenerator<GraphChunk> {
  let nodes: FlowNode[] = [], edges: FlowEdge[] = [];
  let prev: { id: string; block: string } | undefined;
  let rest = '';
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  for (let done = false; !done; ) {
    const read = await reader.read();
    done = read.done;
    const lines = (rest + (read.value ?? '')).split('\n');
    rest = done ? '' : lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith('{ "type": "Feature"')) continue;
      const { properties: p, geometry: g } = JSON.parse(line.replace(/,\s*$/, '')) as Parcel;
      if (!g) continue;
      const ring = g.type === 'Polygon' ? (g.coordinates as number[][][])[0] : (g.coordinates as number[][][][])[0][0];
      const lon = ring.reduce((s, c) => s + c[0], 0) / ring.length;
      const lat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
      const node: FlowNode = {
        id: p.BLKLOT,
        x: Math.round((lon + 122.52) * SCALE * COS_LAT),
        y: Math.round((37.84 - lat) * SCALE),
        label: [p.FROM_ST !== '0' && p.FROM_ST, p.STREET, p.ST_TYPE].filter(Boolean).join(' ') || `Lote ${p.BLKLOT}`,
        inputs: [{ id: 'in' }],
        outputs: [{ id: 'out' }],
      };
      nodes.push(node);
      if (prev?.block === p.BLOCK_NUM) {
        edges.push({ id: `${prev.id}:out->${node.id}:in`, source: prev.id, sourcePort: 'out', target: node.id, targetPort: 'in' });
      }
      prev = { id: node.id, block: p.BLOCK_NUM };
      if (nodes.length >= chunkSize) {
        yield { nodes, edges };
        nodes = [];
        edges = [];
      }
    }
  }
  if (nodes.length) yield { nodes, edges };
}
