import { describe, expect, it } from 'vitest';
import { pipelineState } from './pipeline.js';

describe('pipelineState', () => {
  it('stays waiting until a lead exists', () => {
    expect(pipelineState([]).source).toBe('waiting');
    expect(pipelineState([]).book).toBe('waiting');
  });

  it('moves the active node as steps arrive', () => {
    const early = pipelineState(['received', 'verified']);
    expect(early.source).toBe('done');
    expect(early.check).toBe('done');
    expect(early.queue).toBe('now');
    const offered = pipelineState(['received', 'verified', 'upserted', 'sms_sent', 'email_sent', 'opportunity_created', 'slots_offered']);
    expect(offered.message).toBe('done');
    expect(offered.book).toBe('now');
    expect(pipelineState(['received', 'verified', 'upserted', 'sms_sent', 'booked']).book).toBe('done');
  });
});