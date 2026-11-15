export function readiness(checks: { database: boolean; queue: boolean }): {
  ok: boolean;
  checks: { database: boolean; queue: boolean };
} {
  return { ok: checks.database && checks.queue, checks };
}
