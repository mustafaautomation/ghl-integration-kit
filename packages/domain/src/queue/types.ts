export type JobStatus = 'pending' | 'active' | 'completed' | 'dead';

export interface Job {
  id: string;
  name: string;
  payload: unknown;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: number;
  lastError: string | null;
  correlationId: string | null;
  createdAt: number;
  updatedAt: number;
}
