import { geojsonGraph } from './geojson-graph';

const feature = (lot: string, block: string, geometry: string) =>
  `{ "type": "Feature", "properties": { "BLKLOT": "${lot}", "BLOCK_NUM": "${block}", "FROM_ST": "0", "STREET": "UNKNOWN", "ST_TYPE": null }, "geometry": ${geometry} }`;
const square = '{ "type": "Polygon", "coordinates": [ [ [ -122.4, 37.8, 0 ], [ -122.4, 37.7, 0 ], [ -122.5, 37.7, 0 ], [ -122.5, 37.8, 0 ] ] ] }';
const multi = '{ "type": "MultiPolygon", "coordinates": [ [ [ [ -122.4, 37.8, 0 ], [ -122.5, 37.7, 0 ] ] ] ] }';

describe('geojsonGraph', () => {
  it('turns parcels into nodes, chains lots of the same block and skips null geometry', async () => {
    const text = ['{', '"type": "FeatureCollection",', '"features": [', feature('1', 'A', square), ',', feature('2', 'A', multi), ',', feature('3', 'A', 'null'), ',', feature('4', 'B', square), ']', '}'].join('\n');
    const chunks = [];
    for await (const c of geojsonGraph(new Response(text).body!, 2)) chunks.push(c);
    expect(chunks.length).toBe(2);
    const nodes = chunks.flatMap((c) => c.nodes!);
    expect(nodes.map((n) => n.id)).toEqual(['1', '2', '4']);
    expect(nodes[0].label).toBe('UNKNOWN');
    expect(nodes[1].x).toBe(nodes[0].x);
    expect(chunks.flatMap((c) => c.edges!).map((e) => e.id)).toEqual(['1:out->2:in']);
  });
});
