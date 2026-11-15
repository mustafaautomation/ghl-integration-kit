import { bookSlot, ghlFetch, runMissedCall, runSpeedToLead, type Job } from '@ghl/domain/edge';
import { z } from 'zod';
import type { Env } from './env.js';
import { baseUrl, createServices, flowDeps, type Services } from './runtime.js';

export type JobResult = 'done' | 'dead' | { retrySeconds: number };

const bookPayload = z.object({ leadId: z.string(), startTime: z.string() });
const leadPayload = z.object({ leadId: z.string() });

async function dispatch(env: Env, services: Services, job: Job): Promise<void> {
  const deps = flowDeps(env, services);
  if (job.name === 'speed-to-lead') {
    await runSpeedToLead(deps, leadPayload.parse(job.payload).leadId);
    return;
  }
  if (job.name === 'book-appointment') {
    const body = bookPayload.parse(job.payload);
    await bookSlot(deps, body.leadId, body.startTime);
    return;
  }
  if (job.name === 'missed-call') {
    await runMissedCall(deps, leadPayload.parse(job.payload).leadId);
    return;
  }
  if (job.name === 'ghl-probe') {
    const token = await services.tokens.getValidAccessToken(env.LOCATION_ID);
    await ghlFetch(baseUrl(env), { method: 'GET', path: `/locations/${env.LOCATION_ID}`, token }, { fetchImpl: services.fetchImpl });
    return;
  }
  throw new Error(`unknown_job:${job.name}`);
}

export async function runJob(env: Env, jobId: string): Promise<JobResult> {
  const services = createServices(env);
  const claimed = await services.queue.claim(jobId);
  if (!claimed) {
    const existing = await services.queue.get(jobId);
    if (!existing || existing.status === 'completed' || existing.status === 'dead') return 'done';
    if (existing.status === 'pending' && existing.runAt > Date.now()) {
      return { retrySeconds: Math.max(1, Math.ceil((existing.runAt - Date.now()) / 1000)) };
    }
    return { retrySeconds: 2 };
  }
  try {
    await dispatch(env, services, claimed);
    await services.queue.complete(jobId);
    return 'done';
  } catch (error) {
    const failed = await services.queue.fail(jobId, error);
    if (failed.status === 'dead') return 'dead';
    return { retrySeconds: Math.max(1, Math.ceil(failed.delayMs / 1000)) };
  }
}

export async function drain(env: Env): Promise<void> {
  const services = createServices(env);
  const due = await services.queue.due();
  for (const job of due) {
    await runJob(env, job.id);
  }
}
