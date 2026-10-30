export interface OrgPerson {
  id: string;
  managerId?: string;
  employmentStatus: string;
}
export interface OrgNode<T extends OrgPerson> {
  person: T;
  reports: OrgNode<T>[];
  /** People below this one, at any depth. */
  total: number;
}

/**
 * Builds the reporting tree. Roots are people with no manager or whose manager is not in the list
 * (for example a manager who has left). If bad data ever forms a loop, one member of the loop is
 * promoted to a root so nobody disappears and nothing recurses forever.
 */
export function buildOrgTree<T extends OrgPerson>(
  people: T[],
  sort: (a: T, b: T) => number = () => 0,
): { roots: OrgNode<T>[]; count: number } {
  const byId = new Map(people.map((p) => [p.id, p]));
  const children = new Map<string, T[]>();
  const rootsRaw: T[] = [];
  for (const p of people) {
    if (p.managerId && p.managerId !== p.id && byId.has(p.managerId)) {
      const list = children.get(p.managerId) ?? [];
      list.push(p);
      children.set(p.managerId, list);
    } else rootsRaw.push(p);
  }
  const seen = new Set<string>();
  const make = (p: T): OrgNode<T> => {
    seen.add(p.id);
    const reports = (children.get(p.id) ?? [])
      .filter((c) => !seen.has(c.id))
      .sort(sort)
      .map(make);
    return { person: p, reports, total: reports.reduce((n, r) => n + 1 + r.total, 0) };
  };
  const roots = rootsRaw.sort(sort).map(make);
  // Anyone not reached sits in a loop with no root above them.
  for (const p of [...people].sort(sort)) if (!seen.has(p.id)) roots.push(make(p));
  return { roots, count: people.length };
}

/** The ids of everyone whose name matches, plus all their ancestors, so a search keeps the path visible. */
export function matchWithAncestors<T extends OrgPerson>(
  people: T[],
  matches: (p: T) => boolean,
): Set<string> {
  const byId = new Map(people.map((p) => [p.id, p]));
  const keep = new Set<string>();
  for (const p of people) {
    if (!matches(p)) continue;
    let cur: T | undefined = p;
    for (let i = 0; cur && !keep.has(cur.id) && i < 100; i++) {
      keep.add(cur.id);
      cur = cur.managerId ? byId.get(cur.managerId) : undefined;
    }
  }
  return keep;
}
