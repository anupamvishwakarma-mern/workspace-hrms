import * as SecureStore from 'expo-secure-store';
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
import { roleViewOf, type RoleView } from '@/lib/roles';

const WS_KEY = 'wf.workspace'; // 'self' | 'work', only when "Remember my choice" was ticked
const PERMS_KEY = 'wf.permsSeen';

interface Ctx {
  self: boolean;
  setSelf(v: boolean): void;
  loaded: boolean;
  chosen: boolean;
  saved: 'self' | 'work' | null;
  permsSeen: boolean;
  choose(self: boolean, remember: boolean): void;
  markPermsSeen(): void;
}
const WorkspaceCtx = createContext<Ctx>({
  self: false,
  setSelf: () => undefined,
  loaded: true,
  chosen: true,
  saved: null,
  permsSeen: true,
  choose: () => undefined,
  markPermsSeen: () => undefined,
});

/** Remembers whether a manager/HR/owner is working in their own (employee) space, and the first-run steps. */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [self, setSelf] = useState(false);
  const [chosen, setChosen] = useState(false);
  const [saved, setSaved] = useState<'self' | 'work' | null>(null);
  const [permsSeen, setPermsSeen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [w, p] = await Promise.all([
          SecureStore.getItemAsync(WS_KEY),
          SecureStore.getItemAsync(PERMS_KEY),
        ]);
        if (w === 'self' || w === 'work') {
          setSaved(w);
          setSelf(w === 'self');
        }
        setPermsSeen(p === '1');
      } catch {
        /* keep defaults */
      }
      setLoaded(true);
    })();
  }, []);

  // A new sign-in starts with a fresh choice (unless one was remembered on this phone).
  useEffect(() => {
    if (status === 'signedOut') {
      setChosen(false);
      if (!saved) setSelf(false);
    }
  }, [status, saved]);

  const choose = useCallback((value: boolean, remember: boolean) => {
    setSelf(value);
    setChosen(true);
    const next = value ? 'self' : 'work';
    setSaved(remember ? next : null);
    void (
      remember ? SecureStore.setItemAsync(WS_KEY, next) : SecureStore.deleteItemAsync(WS_KEY)
    ).catch(() => undefined);
  }, []);
  const markPermsSeen = useCallback(() => {
    setPermsSeen(true);
    void SecureStore.setItemAsync(PERMS_KEY, '1').catch(() => undefined);
  }, []);

  const value = useMemo(
    () => ({ self, setSelf, loaded, chosen, saved, permsSeen, choose, markPermsSeen }),
    [self, loaded, chosen, saved, permsSeen, choose, markPermsSeen],
  );
  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}

/** Which version of the app this person sees right now. */
export function useView(): {
  view: RoleView;
  base: RoleView;
  canSwitch: boolean;
  self: boolean;
  setSelf(v: boolean): void;
} {
  const { active } = useAuth();
  const { self, setSelf } = useContext(WorkspaceCtx);
  const base = roleViewOf(active?.roles);
  const canSwitch = base !== 'employee' && !!active?.employeeId;
  return { view: canSwitch && self ? 'employee' : base, base, canSwitch, self, setSelf };
}

/** First-run steps shown after sign-in: allow permissions, then pick a workspace when there are two. */
export function useFirstRun(): {
  step: 'permissions' | 'workspace' | null;
  choose: Ctx['choose'];
  markPermsSeen(): void;
} {
  const { loaded, chosen, saved, permsSeen, choose, markPermsSeen } = useContext(WorkspaceCtx);
  const { canSwitch } = useView();
  const step = !loaded
    ? null
    : !permsSeen
      ? 'permissions'
      : canSwitch && !chosen && !saved
        ? 'workspace'
        : null;
  return { step, choose, markPermsSeen };
}
