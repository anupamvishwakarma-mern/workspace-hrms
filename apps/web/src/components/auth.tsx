'use client';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import type { Membership } from '@/lib/types';

export type AuthStatus =
  'loading' | 'offline' | 'signedOut' | 'needsCompany' | 'noAccess' | 'platform' | 'ready';
interface AuthValue {
  status: AuthStatus;
  email?: string;
  memberships: Membership[];
  active?: Membership;
  can: (...perms: string[]) => boolean;
  /** False when the platform administrator switched this module off for the company. */
  hasModule: (key: string) => boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  selectCompany: (tenantId: string) => void;
  retry: () => void;
}
const Ctx = createContext<AuthValue | null>(null);
export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
};

const KEY = 'wf.tenant';
const readPref = () => {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const writePref = (id: string) => {
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    /* storage unavailable: fall back to asking again next visit */
  }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [email, setEmail] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  const apply = useCallback((list: Membership[], platformAdmin = false) => {
    const usable = list.filter((m) => !m.tenantStatus || m.tenantStatus === 'ACTIVE');
    setMemberships(usable);
    // A platform administrator has no company; they get the platform console instead of an error.
    if (usable.length === 0) return setStatus(platformAdmin ? 'platform' : 'noAccess');
    const saved = readPref();
    const pick =
      usable.find((m) => m.tenantId === saved) ?? (usable.length === 1 ? usable[0] : undefined);
    if (!pick) return setStatus('needsCompany');
    api.setTenant(pick.tenantId);
    setActiveId(pick.tenantId);
    setStatus('ready');
  }, []);

  const reset = useCallback(() => {
    api.setTenant(null);
    qc.clear(); // never leave another company's or user's data in the cache
    setMemberships([]);
    setActiveId(undefined);
    setEmail(undefined);
    setStatus('signedOut');
  }, [qc]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus('loading');
      try {
        if (!(await api.restore())) return void (!cancelled && reset());
        const me = await api.get<{
          email?: string;
          isPlatformAdmin?: boolean;
          memberships: Membership[];
        }>('/auth/me');
        if (!cancelled) {
          setEmail(me.data.email);
          apply(me.data.memberships, me.data.isPlatformAdmin);
        }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.code === 'SESSION_EXPIRED') reset();
        else setStatus('offline');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt, apply, reset]);

  const value = useMemo<AuthValue>(() => {
    const active = memberships.find((m) => m.tenantId === activeId);
    return {
      status,
      email,
      memberships,
      active,
      can: (...perms) => !!active && perms.some((p) => active.permissions.includes(p)),
      hasModule: (key) => !!active && (active.modules ? active.modules.includes(key) : true),
      async signIn(e, password) {
        const res = await api.login(e, password);
        qc.clear();
        setEmail(res.user.email);
        apply(res.memberships, res.user.isPlatformAdmin);
      },
      async signOut() {
        await api.logout();
        reset();
      },
      selectCompany(tenantId) {
        if (!memberships.some((m) => m.tenantId === tenantId)) return;
        qc.clear();
        api.setTenant(tenantId);
        setActiveId(tenantId);
        writePref(tenantId);
        setStatus('ready');
      },
      retry: () => setAttempt((n) => n + 1),
    };
  }, [status, email, memberships, activeId, apply, reset, qc]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
