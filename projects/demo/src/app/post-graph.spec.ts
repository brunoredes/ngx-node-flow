import { postGraph } from './post-graph';

describe('postGraph', () => {
  it('links the post to each comment', () => {
    const post = { id: 1, title: 'T', body: 'B' };
    const comments = [1, 2].map((id) => ({ id, postId: 1, name: `c${id}`, email: 'a@b.c', body: 'x' }));
    const { nodes, edges } = postGraph(post, comments);
    expect(nodes.map((n) => n.label)).toEqual(['T', 'c1', 'c2']);
    expect(edges.map((e) => [e.source, e.target])).toEqual([['post-1', 'comment-1'], ['post-1', 'comment-2']]);
  });
});

describe('postGraph without comments', () => {
  it('returns only the post node', () => {
    const { nodes, edges } = postGraph({ id: 2, title: 'T', body: 'B' }, []);
    expect(nodes.map((n) => n.id)).toEqual(['post-2']);
    expect(edges).toEqual([]);
  });
});
