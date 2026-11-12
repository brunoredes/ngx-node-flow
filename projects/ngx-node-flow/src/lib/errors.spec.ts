import { EdgeRejectedError } from './errors';

describe('EdgeRejectedError', () => {
  it('is a real Error carrying the edge and the reason', () => {
    const edge = { id: 'e', source: 'a', sourcePort: 'o', target: 'b', targetPort: 'i' };
    const err = new EdgeRejectedError(edge, 'cycle');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(EdgeRejectedError);
    expect(err).toMatchObject({ name: 'EdgeRejectedError', edge, reason: 'cycle' });
    expect(err.message).toContain('a:o -> b:i');
  });
});
