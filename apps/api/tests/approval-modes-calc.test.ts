import { describe, expect, it } from 'vitest';
import { requiredApprovals } from '../src/modules/approvals/approvals.service';

describe('approvals a step needs', () => {
  it('is one unless the step asks for more', () => {
    expect(requiredApprovals('ANY', undefined, 5)).toBe(1);
    expect(requiredApprovals(undefined, undefined, 5)).toBe(1);
    expect(requiredApprovals(null, null, 5)).toBe(1);
  });
  it('is everyone for ALL, and a quorum for QUORUM', () => {
    expect(requiredApprovals('ALL', undefined, 3)).toBe(3);
    expect(requiredApprovals('QUORUM', 2, 3)).toBe(2);
  });
  it('never asks for more people than can approve', () => {
    expect(requiredApprovals('QUORUM', 5, 3)).toBe(3);
    expect(requiredApprovals('ALL', undefined, 1)).toBe(1);
    expect(requiredApprovals('QUORUM', 2, 1)).toBe(1);
    expect(requiredApprovals('ALL', undefined, 0)).toBe(1);
  });
});
