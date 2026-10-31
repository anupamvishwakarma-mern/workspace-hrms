/** ROI estimate. Pure and deliberately conservative; every output is an estimate, not a guaranteed saving. */
export interface RoiInput {
  employees: number;
  hrTeamSize: number;
  monthlyAdminHours: number;
  hourlyHrCost: number;
  currentSoftwareSpendMonthly: number;
  /** Share of admin time assumed to be automated, in percent. User-adjustable. */
  automationPercent: number;
  /** Subscription cost per month to compare against (optional). */
  subscriptionMonthly?: number;
}
export interface RoiResult {
  hoursSavedMonthly: number;
  hoursSavedYearly: number;
  costSavedMonthly: number;
  costSavedYearly: number;
  netMonthly: number | null;
  netYearly: number | null;
}
const r = (n: number) => Math.round(n * 100) / 100;
export function estimateRoi(i: RoiInput): RoiResult {
  const pct = Math.min(80, Math.max(0, i.automationPercent)) / 100;
  const hoursSavedMonthly = r(Math.max(0, i.monthlyAdminHours) * pct);
  const costSavedMonthly = r(hoursSavedMonthly * Math.max(0, i.hourlyHrCost));
  const net =
    i.subscriptionMonthly == null
      ? null
      : r(
          costSavedMonthly +
            Math.max(0, i.currentSoftwareSpendMonthly) -
            Math.max(0, i.subscriptionMonthly),
        );
  return {
    hoursSavedMonthly,
    hoursSavedYearly: r(hoursSavedMonthly * 12),
    costSavedMonthly,
    costSavedYearly: r(costSavedMonthly * 12),
    netMonthly: net,
    netYearly: net == null ? null : r(net * 12),
  };
}
