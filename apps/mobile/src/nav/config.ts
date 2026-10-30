import type { Href } from 'expo-router';
import type { RoleView } from '@/lib/roles';
import type { NavIconName } from './icons';

export type TabName = 'index' | 'history' | 'requests' | 'team' | 'more';
export type BadgeKey = 'approvals' | 'attendance' | 'leave' | 'decisions';

export interface NavItem {
  key: string;
  label: string;
  icon: NavIconName;
  /** Opens a tab (stays in the footer-nav family) or pushes a screen. */
  tab?: TabName;
  href?: Href;
  /** Count of things that need this person's action. */
  badge?: BadgeKey;
  /** Raised round button in the middle of the footer. */
  center?: boolean;
}
export interface DrawerGroup {
  title: string;
  items: NavItem[];
}

const home: NavItem = { key: 'home', label: 'Home', icon: 'home', tab: 'index' };
const attendance: NavItem = { key: 'att', label: 'Attendance', icon: 'clock', tab: 'history' };
const leave: NavItem = { key: 'leave', label: 'Leave', icon: 'calendar', tab: 'requests' };
const people: NavItem = { key: 'people', label: 'People', icon: 'team', tab: 'team' };
const me: NavItem = { key: 'me', label: 'Me', icon: 'user', tab: 'more' };
const more: NavItem = { key: 'more', label: 'More', icon: 'more', tab: 'more' };
const pay: NavItem = { key: 'pay', label: 'Pay', icon: 'wallet', href: '/hr/payslips' };
const punch: NavItem = { key: 'punch', label: 'Punch', icon: 'clock', tab: 'index', center: true };

/** Footer navigation: at most five items; everything else lives in the drawer. */
export function footerFor(view: RoleView, withPunch = false): NavItem[] {
  switch (view) {
    case 'employee':
      return withPunch ? [home, attendance, punch, leave, me] : [home, attendance, leave, pay, me];
    case 'manager':
      return [
        home,
        { key: 'appr', label: 'Approvals', icon: 'inbox', tab: 'requests', badge: 'approvals' },
        { key: 'team', label: 'Team', icon: 'team', tab: 'team' },
        attendance,
        me,
      ];
    case 'hr':
      return [
        home,
        { ...attendance, badge: 'attendance' },
        { ...leave, badge: 'leave' },
        people,
        more,
      ];
    case 'owner':
      return [home, attendance, leave, people, more];
  }
}

const holidays: NavItem = { key: 'hol', label: 'Holidays', icon: 'calendar', href: '/hr/holidays' };
const handbook: NavItem = { key: 'hb', label: 'Policies', icon: 'shield', href: '/hr/handbook' };
const settings: NavItem = { key: 'set', label: 'Settings', icon: 'gear', href: '/hr/settings' };
const language: NavItem = { key: 'lang', label: 'Language', icon: 'globe', href: '/hr/language' };

/** Same groups on every screen, per role. */
export function drawerFor(view: RoleView): DrawerGroup[] {
  switch (view) {
    case 'employee':
      return [
        { title: 'Main', items: [home, attendance, leave, pay] },
        {
          title: 'My space',
          items: [
            { key: 'prof', label: 'Profile', icon: 'user', href: '/hr/profile' },
            { key: 'doc', label: 'Documents', icon: 'doc', href: '/hr/letters' },
            holidays,
            handbook,
          ],
        },
        { title: 'Support', items: [settings, language] },
      ];
    case 'manager':
      return [
        {
          title: 'Main',
          items: [
            home,
            { key: 'appr', label: 'Approvals', icon: 'inbox', tab: 'requests', badge: 'approvals' },
            { key: 'team', label: 'Team', icon: 'team', tab: 'team' },
            attendance,
          ],
        },
        { title: 'Company', items: [holidays, handbook] },
        { title: 'Me', items: [settings, language] },
      ];
    case 'hr':
      return [
        {
          title: 'Main',
          items: [
            home,
            { ...attendance, badge: 'attendance' },
            { ...leave, badge: 'leave' },
            people,
          ],
        },
        { title: 'Admin', items: [holidays, handbook] },
        { title: 'Me', items: [settings, language] },
      ];
    case 'owner':
      return [
        { title: 'Main', items: [home, attendance, leave, people] },
        {
          title: 'Decide',
          items: [
            {
              key: 'dec',
              label: 'Decisions',
              icon: 'inbox',
              tab: 'requests',
              badge: 'decisions',
            },
          ],
        },
        { title: 'More', items: [holidays, handbook, settings, language] },
      ];
  }
}

export const TAB_TITLE: Record<RoleView, Record<TabName, string>> = {
  employee: {
    index: 'Home',
    history: 'Attendance',
    requests: 'Leave',
    team: 'People',
    more: 'Me',
  },
  manager: {
    index: 'Home',
    history: 'Attendance',
    requests: 'Approvals',
    team: 'Team',
    more: 'Me',
  },
  hr: { index: 'Home', history: 'Attendance', requests: 'Leave', team: 'People', more: 'More' },
  owner: { index: 'Home', history: 'Attendance', requests: 'Leave', team: 'People', more: 'More' },
};

/** Badges show counts that need action and stop at 99+. */
export const badgeText = (n: number): string => (n > 99 ? '99+' : String(n));

export const ROLE_LABEL: Record<RoleView, string> = {
  owner: 'Owner',
  hr: 'HR',
  manager: 'Manager',
  employee: 'Employee',
};
