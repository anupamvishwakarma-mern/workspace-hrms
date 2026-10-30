import { DateTime } from 'luxon';
import { useAuth } from '@/auth/AuthProvider';
import { useMyEmployee } from '@/hooks/queries';

/** First name from the employee record, else the start of the sign-in email. */
export function useFirstName() {
  const { email } = useAuth();
  const me = useMyEmployee();
  return me.data?.firstName || email?.split('@')[0] || 'there';
}

export const greetingDate = () => DateTime.now().toFormat('ccc, d LLL yyyy');
export const thisMonth = () => DateTime.now().toFormat('yyyy-LL');
export const WINDOW_DAYS = 2;
export const daysSince = (iso?: string) =>
  iso ? Math.floor((Date.now() - Date.parse(iso)) / 86_400_000) : 0;
export const rangeText = (a: string, b: string) => {
  const f = (d: string) => DateTime.fromISO(d.slice(0, 10), { zone: 'utc' }).toFormat('d LLL');
  return a.slice(0, 10) === b.slice(0, 10) ? f(a) : `${f(a)} – ${f(b)}`;
};
export const personName = (e?: { firstName: string; lastName: string }) =>
  e ? `${e.firstName} ${e.lastName}` : 'Employee';
export const monthName = (m: string) => DateTime.fromISO(`${m}-01`).toFormat('LLLL yyyy');
