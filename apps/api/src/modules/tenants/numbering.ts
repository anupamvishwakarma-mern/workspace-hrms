import type { Types } from 'mongoose';
import { Tenant } from '../../database/models/tenant.model';

export interface NumberingRule {
  prefix: string;
  padding: number;
}
export interface Numbering {
  employee: NumberingRule;
  letter: NumberingRule;
  document: NumberingRule;
}

export const DEFAULT_NUMBERING: Numbering = {
  employee: { prefix: 'EMP-', padding: 4 },
  letter: { prefix: 'LTR-', padding: 4 },
  document: { prefix: 'DOC-', padding: 4 },
};

/** Letters, digits, dash, underscore and slash only, so codes stay safe in file names, URLs and CSV. */
export const PREFIX_RE = /^[A-Z0-9\-_/]{0,10}$/;

type StoredRule = { prefix?: string | null; padding?: number | null } | null | undefined;
export function resolveNumbering(
  stored?: { employee?: StoredRule; letter?: StoredRule; document?: StoredRule } | null,
): Numbering {
  const pick = (k: keyof Numbering): NumberingRule => ({
    prefix: stored?.[k]?.prefix ?? DEFAULT_NUMBERING[k].prefix,
    padding: stored?.[k]?.padding ?? DEFAULT_NUMBERING[k].padding,
  });
  return { employee: pick('employee'), letter: pick('letter'), document: pick('document') };
}

export function formatNumber(rule: NumberingRule, seq: number, middle = ''): string {
  return `${rule.prefix}${middle}${String(seq).padStart(rule.padding, '0')}`;
}

export async function numberingFor(tenantId: Types.ObjectId): Promise<Numbering> {
  const t = await Tenant.findById(tenantId).select('settings.numbering').lean();
  return resolveNumbering(t?.settings?.numbering);
}
