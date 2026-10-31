import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import type { Logger } from 'pino';
import type { Env } from '../config/env';
import { runLeaveAutomation } from '../modules/leave/automation';
import { runPendingTenantMigrations, runTenantDbHealthChecks } from './tenantDatabase';
import {
  cleanupStaleUploads,
  dailyAttendanceSweep,
  escalateApprovals,
  purgeLocationData,
  purgePunchPhotos,
} from './handlers';

export const QUEUE_NAME = 'workforce-maintenance';
export const JOBS = {
  sweep: 'daily-attendance-sweep',
  purge: 'purge-location-data',
  uploads: 'cleanup-stale-uploads',
  escalate: 'escalate-approvals',
  leave: 'leave-automation',
  dbHealth: 'tenant-db-health',
  dbMigrate: 'tenant-db-migrate',
} as const;

/** BullMQ needs maxRetriesPerRequest=null on the blocking worker connection. */
export const redisConnection = (url: string) =>
  new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });

export interface JobDeps {
  env: Env;
  log: Logger;
  now?: () => Date;
}

/** Job name -> handler. Handlers are plain functions so they are testable without Redis. */
export async function runJob(name: string, deps: JobDeps): Promise<unknown> {
  const now = (deps.now ?? (() => new Date()))();
  switch (name) {
    case JOBS.sweep:
      return dailyAttendanceSweep(now, { localHours: [1, 2], log: deps.log });
    case JOBS.purge:
      return {
        ...(await purgeLocationData(now, deps.env.LOCATION_RETENTION_DAYS)),
        photos: await purgePunchPhotos(deps.env, now, deps.env.PHOTO_RETENTION_DAYS),
      };
    case JOBS.uploads:
      return cleanupStaleUploads(deps.env, now);
    case JOBS.leave:
      return runLeaveAutomation(now, { localHours: [2, 3], log: deps.log });
    case JOBS.escalate:
      return escalateApprovals(deps.env, now);
    case JOBS.dbHealth:
      return runTenantDbHealthChecks(now, { log: deps.log });
    case JOBS.dbMigrate:
      return runPendingTenantMigrations(now, { log: deps.log });
    default:
      throw new Error(`Unknown job: ${name}`);
  }
}

/**
 * Idempotent: calling it on every worker start just updates the same scheduler entries.
 *  - sweep: hourly; each tenant is only processed while its own local time is 01:00-02:59, and the
 *    3-day lookback makes a missed night self-heal.
 *  - purge: daily 03:15 UTC.
 */
export async function registerSchedules(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(JOBS.sweep, { pattern: '5 * * * *' }, { name: JOBS.sweep });
  await queue.upsertJobScheduler(JOBS.uploads, { pattern: '30 * * * *' }, { name: JOBS.uploads });
  await queue.upsertJobScheduler(JOBS.escalate, { pattern: '10 * * * *' }, { name: JOBS.escalate });
  await queue.upsertJobScheduler(JOBS.leave, { pattern: '20 * * * *' }, { name: JOBS.leave });
  await queue.upsertJobScheduler(JOBS.dbHealth, { pattern: '*/5 * * * *' }, { name: JOBS.dbHealth });
  await queue.upsertJobScheduler(JOBS.dbMigrate, { pattern: '40 * * * *' }, { name: JOBS.dbMigrate });
  await queue.upsertJobScheduler(JOBS.purge, { pattern: '15 3 * * *' }, { name: JOBS.purge });
}

export function createQueue(redisUrl: string): Queue {
  return new Queue(QUEUE_NAME, {
    connection: redisConnection(redisUrl),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  });
}

export function createWorker(redisUrl: string, deps: JobDeps): Worker {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      const result = await runJob(job.name, deps);
      deps.log.info({ job: job.name, result }, 'job completed');
      return JSON.parse(JSON.stringify(result ?? null));
    },
    { connection: redisConnection(redisUrl), concurrency: 1 },
  );
  worker.on('failed', (job, err) => deps.log.error({ job: job?.name, err }, 'job failed'));
  return worker;
}
