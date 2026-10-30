import * as SecureStore from 'expo-secure-store';
import { usePathname, useRouter, type Href } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { useReviewCorrections, useReviewExceptions, useReviewLeave } from '@/hooks/insights';
import { useView } from '@/workspace';
import type { NavItem, TabName } from './config';

const PUNCH_KEY = 'wf.punchNav';

interface NavCtx {
  open: boolean;
  setOpen(v: boolean): void;
  /** Employees can choose a round Punch button in the middle of the footer. */
  punchFooter: boolean;
  setPunchFooter(v: boolean): void;
}
const Ctx = createContext<NavCtx>({
  open: false,
  setOpen: () => undefined,
  punchFooter: false,
  setPunchFooter: () => undefined,
});
export const useNav = () => useContext(Ctx);

export function NavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [punchFooter, setPunch] = useState(false);
  useEffect(() => {
    SecureStore.getItemAsync(PUNCH_KEY)
      .then((v) => setPunch(v === '1'))
      .catch(() => undefined);
  }, []);
  const setPunchFooter = useCallback((v: boolean) => {
    setPunch(v);
    void SecureStore.setItemAsync(PUNCH_KEY, v ? '1' : '0').catch(() => undefined);
  }, []);
  const value = useMemo(
    () => ({ open, setOpen, punchFooter, setPunchFooter }),
    [open, punchFooter, setPunchFooter],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const TABS: TabName[] = ['index', 'history', 'requests', 'team', 'more'];
/** Which tab is showing, from the URL. */
export function useCurrentTab(): TabName {
  const seg = usePathname().split('/')[1] ?? '';
  return (TABS as string[]).includes(seg) ? (seg as TabName) : 'index';
}

export const tabHref = (tab: TabName): Href => (tab === 'index' ? '/' : (`/${tab}` as Href));

/** Open a footer or drawer item. */
export function useGo() {
  const router = useRouter();
  return useCallback(
    (item: NavItem) => {
      if (item.tab) router.navigate(tabHref(item.tab));
      else if (item.href) router.push(item.href);
    },
    [router],
  );
}

/** Things waiting for this person's decision. Only asked for managers, HR and owners. */
export function useNavCounts() {
  const { view } = useView();
  const { active } = useAuth();
  const on = view !== 'employee' && !!active;
  const leave = useReviewLeave({ status: 'PENDING' }, on).data?.length ?? 0;
  const corr = useReviewCorrections('PENDING', on).data?.length ?? 0;
  const exc = useReviewExceptions('PENDING', on).data?.length ?? 0;
  const total = leave + corr + exc;
  return { leave, attendance: corr + exc, approvals: total, decisions: total, total };
}
