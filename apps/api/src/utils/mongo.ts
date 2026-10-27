import { AppError } from './errors';

export const isDuplicateKey = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;

export function rethrowDuplicate(err: unknown, message: string): never {
  if (isDuplicateKey(err)) throw AppError.conflict(message);
  throw err;
}
