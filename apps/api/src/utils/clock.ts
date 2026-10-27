/** Injectable time source so attendance logic (server-authoritative timestamps) is testable. */
export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };
