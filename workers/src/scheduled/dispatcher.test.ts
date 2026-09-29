/**
 * Unit coverage for the cron dispatcher — `isJobDue` decisions, the schedule
 * table's invariants, and tick behaviour (lease skip, failure isolation,
 * failed:true, kill switch) against a fake SqlClient that records its queries.
 *
 * Real-SQL semantics of the lease statements themselves are covered by
 * `scheduled.pglite.node.test.ts`; here the SQL is stubbed so the control flow
 * is what is asserted.
 */
import { describe, expect, it } from 'vitest';
import type { Env } from '../types/env';
import { runScheduledTick } from './dispatcher';
import {
  isJobDue,
  SCHEDULED_JOBS,
  type JobResult,
  type ScheduledJob,
  type SqlClient,
} from './schedule';

const ENV = { NODE_ENV: 'test' } as unknown as Env;

function job(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    name: 'test-job',
    cadence: { kind: 'hourly' },
    leaseSeconds: 300,
    run: async () => ({ summary: {} }),
    ...overrides,
  };
}

interface FakeCall {
  text: string;
  values: unknown[];
}

/**
 * A SqlClient stand-in that routes on query text. `stateRows` answers the
 * run-state SELECT; `leaseAcquired` answers the INSERT ... RETURNING; releases
 * always succeed.
 */
function fakeSql(options: { stateRows?: unknown[]; leaseAcquired?: boolean } = {}) {
  const calls: FakeCall[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = '';
    strings.forEach((chunk, index) => {
      text += chunk;
      if (index < values.length) text += `$${index + 1}`;
    });
    calls.push({ text, values });
    if (/FROM scheduled_job_runs/.test(text)) return options.stateRows ?? [];
    if (/INSERT INTO scheduled_job_runs/.test(text)) {
      return options.leaseAcquired === false ? [] : [{ job_name: 'x' }];
    }
    if (/UPDATE scheduled_job_runs/.test(text)) return [];
    throw new Error(`unexpected query: ${text}`);
  }) as unknown as SqlClient;
  return { sql, calls };
}

describe('isJobDue', () => {
  const hourly = job({ cadence: { kind: 'hourly' } });
  const dailyMidnight = job({ cadence: { kind: 'daily', hourUtc: 0 } });
  const dailyFive = job({ cadence: { kind: 'daily', hourUtc: 5 } });

  it('hourly jobs are always due', () => {
    const asOf = new Date('2026-10-01T03:30:00Z');
    expect(isJobDue(hourly, undefined, asOf)).toBe(true);
    expect(isJobDue(hourly, { lastSucceededAt: new Date('2026-10-01T03:00:00Z') }, asOf)).toBe(
      true,
    );
  });

  it('a daily job is not due before its UTC slot', () => {
    expect(isJobDue(dailyFive, undefined, new Date('2026-10-01T03:00:00Z'))).toBe(false);
  });

  it('a daily job at/after its slot is due when it never ran', () => {
    expect(isJobDue(dailyFive, undefined, new Date('2026-10-01T05:00:00Z'))).toBe(true);
    expect(isJobDue(dailyMidnight, undefined, new Date('2026-10-01T00:00:00Z'))).toBe(true);
  });

  it('is not due when it already succeeded in today’s slot', () => {
    const asOf = new Date('2026-10-01T06:00:00Z');
    expect(isJobDue(dailyFive, { lastSucceededAt: new Date('2026-10-01T05:00:00Z') }, asOf)).toBe(
      false,
    );
  });

  it('is due again when the last success was before today’s slot (catch-up)', () => {
    // Tick at hour 5 for a hourUtc 0 job — the slot passed hours ago and the
    // last success was yesterday, so the delayed tick still does today's work.
    const asOf = new Date('2026-10-01T05:00:00Z');
    expect(
      isJobDue(dailyMidnight, { lastSucceededAt: new Date('2026-09-30T00:00:00Z') }, asOf),
    ).toBe(true);
  });

  it('retries a failed run on the next tick (lastSucceededAt stays stale)', () => {
    // A failed run leaves last_succeeded_at untouched, so the same slot is
    // still owed.
    const asOf = new Date('2026-10-01T06:00:00Z');
    expect(isJobDue(dailyFive, { lastSucceededAt: new Date('2026-09-30T05:00:00Z') }, asOf)).toBe(
      true,
    );
  });
});

describe('SCHEDULED_JOBS table', () => {
  it('has unique job names', () => {
    const names = SCHEDULED_JOBS.map((j) => j.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives each daily job a distinct hourUtc in 0–23', () => {
    const hours = SCHEDULED_JOBS.filter((j) => j.cadence.kind === 'daily').map(
      (j) => (j.cadence as { hourUtc: number }).hourUtc,
    );
    for (const hour of hours) {
      expect(hour).toBeGreaterThanOrEqual(0);
      expect(hour).toBeLessThanOrEqual(23);
    }
    expect(new Set(hours).size).toBe(hours.length);
  });

  it('declares a positive lease for every job', () => {
    for (const j of SCHEDULED_JOBS) {
      expect(j.leaseSeconds).toBeGreaterThan(0);
    }
  });
});

describe('runScheduledTick', () => {
  it('does nothing when SCHEDULED_JOBS_DISABLED is set', async () => {
    const { sql, calls } = fakeSql();
    const run = { ran: 0 };
    const report = await runScheduledTick({ ...ENV, SCHEDULED_JOBS_DISABLED: 'true' }, new Date(), {
      sql,
      jobs: [
        job({
          run: async () => {
            run.ran += 1;
            return { summary: {} };
          },
        }),
      ],
    });
    expect(report.disabled).toBe(true);
    expect(run.ran).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('skips a not-due job without touching the lease', async () => {
    const daily = job({
      name: 'daily-job',
      cadence: { kind: 'daily', hourUtc: 5 },
      run: async () => {
        throw new Error('should not run');
      },
    });
    const { sql, calls } = fakeSql();
    const report = await runScheduledTick(ENV, new Date('2026-10-01T03:00:00Z'), {
      sql,
      jobs: [daily],
    });
    expect(report.jobs).toEqual([{ job: 'daily-job', outcome: 'not-due', durationMs: 0 }]);
    expect(calls).toHaveLength(1); // the state SELECT only
  });

  it('skips when the lease is held and does not run the job', async () => {
    let ran = 0;
    const { sql } = fakeSql({ leaseAcquired: false });
    const report = await runScheduledTick(ENV, new Date('2026-10-01T00:00:00Z'), {
      sql,
      jobs: [
        job({
          name: 'leased',
          run: async () => {
            ran += 1;
            return { summary: {} };
          },
        }),
      ],
    });
    expect(report.jobs[0].outcome).toBe('skipped-lease-held');
    expect(ran).toBe(0);
  });

  it('isolates a throwing job: marks it failed, captures it, runs the next job', async () => {
    const captured: unknown[] = [];
    let secondRan = 0;
    const { sql, calls } = fakeSql();
    const report = await runScheduledTick(ENV, new Date('2026-10-01T00:00:00Z'), {
      sql,
      captureException: (e) => {
        captured.push(e);
      },
      jobs: [
        job({
          name: 'thrower',
          run: async () => {
            throw new Error('boom');
          },
        }),
        job({
          name: 'after',
          run: async () => {
            secondRan += 1;
            return { summary: { ok: true } };
          },
        }),
      ],
    });
    expect(report.jobs[0].outcome).toBe('failed');
    expect(report.jobs[1].outcome).toBe('succeeded');
    expect(secondRan).toBe(1);
    expect(captured).toHaveLength(1);
    // The release UPDATE ran for both jobs.
    expect(calls.filter((c) => /UPDATE scheduled_job_runs/.test(c.text))).toHaveLength(2);
  });

  it('records failed:true results as failed without throwing', async () => {
    const result: JobResult = { summary: { purged: 3, failed: 1 }, failed: true };
    const { sql } = fakeSql();
    const report = await runScheduledTick(ENV, new Date('2026-10-01T00:00:00Z'), {
      sql,
      jobs: [job({ name: 'partial', run: async () => result })],
    });
    expect(report.jobs[0].outcome).toBe('failed');
    expect(report.jobs[0].summary).toEqual({ purged: 3, failed: 1 });
  });
});
