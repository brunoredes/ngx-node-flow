import { FlowEdge, FlowNode } from 'ngx-node-flow';

export interface Post { id: number; title: string; body: string }
export interface PostComment { id: number; postId: number; name: string; email: string; body: string }

/** One node for the post, one per comment in a column to its right, each linked from the post. */
export function postGraph(post: Post, comments: PostComment[]): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const postId = `post-${post.id}`;
  const nodes: FlowNode[] = [
    { id: postId,
      x: 0,
      y: ((comments.length - 1) * 90) / 2,
      label: post.title,
      outputs: [{ id: 'out' }], 
      data: { body: post.body } 
    },
    ...comments.map((c, i) => ({
      id: `comment-${c.id}`,
      x: 320,
      y: i * 90,
      label: c.name,
      inputs: [{ id: 'in' }],
      data: { email: c.email, body: c.body },
    })),
  ];
  const edges = comments.map((c) => ({ id: `${postId}->comment-${c.id}`, source: postId, sourcePort: 'out', target: `comment-${c.id}`, targetPort: 'in' }));
  return { nodes, edges };
}
