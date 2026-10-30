import { describe, expect, it } from 'vitest';
import { buildOrgTree, matchWithAncestors } from '../src/lib/org';

const p = (id: string, managerId?: string) => ({ id, managerId, employmentStatus: 'ACTIVE' });
const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

describe('buildOrgTree', () => {
  it('nests reports under managers and counts everyone below', () => {
    const { roots } = buildOrgTree([p('ceo'), p('a', 'ceo'), p('b', 'ceo'), p('a1', 'a'), p('a2', 'a')], byId);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.total).toBe(4);
    expect(roots[0]!.reports.map((r) => r.person.id)).toEqual(['a', 'b']);
    expect(roots[0]!.reports[0]!.total).toBe(2);
  });
  it('treats people whose manager is not in the list as roots', () => {
    const { roots } = buildOrgTree([p('x', 'gone'), p('y', 'x')], byId);
    expect(roots.map((r) => r.person.id)).toEqual(['x']);
    expect(roots[0]!.reports[0]!.person.id).toBe('y');
  });
  it('survives a reporting loop without losing anyone', () => {
    const { roots } = buildOrgTree([p('a', 'b'), p('b', 'a'), p('c')], byId);
    const ids: string[] = [];
    const walk = (n: (typeof roots)[number]) => {
      ids.push(n.person.id);
      n.reports.forEach(walk);
    };
    roots.forEach(walk);
    expect(ids.sort()).toEqual(['a', 'b', 'c']);
  });
  it('treats someone who is their own manager as a root', () => {
    expect(buildOrgTree([p('a', 'a')], byId).roots).toHaveLength(1);
  });
});

describe('matchWithAncestors', () => {
  it('keeps the chain above each match', () => {
    const people = [p('ceo'), p('a', 'ceo'), p('a1', 'a'), p('b', 'ceo')];
    const keep = matchWithAncestors(people, (x) => x.id === 'a1');
    expect([...keep].sort()).toEqual(['a', 'a1', 'ceo']);
  });
});
