import { useQueryClient } from '@tanstack/react-query';
import * as Application from 'expo-application';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import { api, onSessionExpired } from '@/lib/client';
import { ApiError } from '@/lib/errors';
import { meData, type Membership } from '@/lib/schemas';
import { tenantPref } from '@/lib/session-storage';

export type AuthStatus =
  'loading' | 'offline' | 'signedOut' | 'needsCompany' | 'noAccess' | 'ready';

interface AuthValue {
  status: AuthStatus;
  email?: string;
  memberships: Membership[];
  active?: Membership;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  selectCompany(tenantId: string): Promise<void>;
  retry(): void;
}
const Ctx = createContext<AuthValue | null>(null);
export const useAuth = (): AuthValue => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [email, setEmail] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);

  const applyMemberships = useCallback(async (list: Membership[]) => {
    const usable = list.filter((m) => !m.tenantStatus || m.tenantStatus === 'ACTIVE');
    setMemberships(usable);
    if (usable.length === 0) {
      api.setTenant(null);
      setActiveId(undefined);
      setStatus('noAccess');
      return;
    }
    const saved = await tenantPref.get().catch(() => null);
    const pick =
      usable.find((m) => m.tenantId === saved) ?? (usable.length === 1 ? usable[0] : undefined);
    if (!pick) {
      setStatus('needsCompany');
      return;
    }
    api.setTenant(pick.tenantId);
    setActiveId(pick.tenantId);
    setStatus('ready');
  }, []);

  const reset = useCallback(() => {
    api.setTenant(null);
    qc.clear(); // never leave one company's or user's data in the cache
    setMemberships([]);
    setActiveId(undefined);
    setEmail(undefined);
    setStatus('signedOut');
  }, [qc]);

  useEffect(() => {
    mounted.current = true;
    const off = onSessionExpired(() => mounted.current && reset());
    return () => {
      mounted.current = false;
      off();
    };
  }, [reset]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus('loading');
      try {
        if (!(await api.restore())) return !cancelled && reset();
        const me = await api.call({ path: '/auth/me', schema: meData, tenant: false });
        if (!cancelled) await applyMemberships(me.data.memberships);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.isNetwork)
          setStatus('offline'); // keep the session; just cannot reach the server
        else if (!(e instanceof ApiError && e.code === 'SESSION_EXPIRED')) setStatus('offline');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt, applyMemberships, reset]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      email,
      memberships,
      active: memberships.find((m) => m.tenantId === activeId),
      async signIn(e, password) {
        const label = `${Application.applicationName ?? 'Workforce'} (${Platform.OS})`;
        const res = await api.login(e, password, label);
        qc.clear();
        setEmail(res.user.email);
        await applyMemberships(res.memberships);
      },
      async signOut() {
        await api.logout();
        reset();
      },
      async selectCompany(tenantId) {
        const m = memberships.find((x) => x.tenantId === tenantId);
        if (!m) return;
        qc.clear();
        api.setTenant(tenantId);
        setActiveId(tenantId);
        await tenantPref.set(tenantId).catch(() => undefined);
        setStatus('ready');
      },
      retry: () => setAttempt((n) => n + 1),
    }),
    [status, email, memberships, activeId, applyMemberships, reset, qc],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
