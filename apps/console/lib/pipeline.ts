export type NodeId = 'source' | 'check' | 'queue' | 'contact' | 'message' | 'book';
export type NodeState = 'waiting' | 'now' | 'done';

const order: NodeId[] = ['source', 'check', 'queue', 'contact', 'message', 'book'];

export function pipelineState(types: string[]): Record<NodeId, NodeState> {
  const has = (type: string) => types.includes(type);
  const done: Record<NodeId, boolean> = {
    source: has('received'),
    check: has('verified'),
    queue: has('upserted') || has('deduped'),
    contact: has('upserted') || has('deduped'),
    message: has('sms_sent') || has('email_sent') || has('text_back'),
    book: has('booked'),
  };
  const result = {} as Record<NodeId, NodeState>;
  let marked = false;
  for (const id of order) {
    if (done[id]) result[id] = 'done';
    else if (!marked && types.length > 0) {
      result[id] = 'now';
      marked = true;
    } else result[id] = 'waiting';
  }
  if (has('slots_offered') && !has('booked')) result.book = 'now';
  return result;
}
