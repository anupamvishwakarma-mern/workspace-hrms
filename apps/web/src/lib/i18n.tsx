'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/** English strings. Other languages must supply the same keys (checked by a test). */
export const en = {
  'nav.dashboard': 'Dashboard',
  'nav.attendance': 'Attendance',
  'nav.approvals': 'Approvals',
  'nav.leave': 'Leave',
  'nav.employees': 'Employees',
  'nav.team': 'Team today',
  'nav.departments': 'Departments',
  'nav.designations': 'Designations',
  'nav.requests': 'Requests',
  'nav.workflows': 'Approval workflows',
  'nav.shifts': 'Shifts',
  'nav.locations': 'Locations',
  'nav.holidays': 'Holidays',
  'nav.payroll': 'Payroll',
  'nav.letters': 'Letters',
  'nav.handbook': 'HR handbook',
  'nav.reports': 'Reports',
  'nav.audit': 'Audit log',
  'nav.settings': 'Settings',
  'group.overview': 'Overview',
  'group.workforce': 'Workforce',
  'group.hr': 'HR & pay',
  'group.setup': 'Company setup',
  'group.insights': 'Insights',
  'group.admin': 'Admin',
  'common.language': 'Language',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.add': 'Add',
  'common.edit': 'Edit',
  'common.status': 'Status',
  'team.title': 'Team today',
  'team.desc': 'Who is working, on break, on leave or not in yet. Updates every minute.',
  'team.search': 'Search by name',
  'team.all': 'All',
  'team.WORKING': 'Working',
  'team.ON_BREAK': 'On break',
  'team.CHECKED_OUT': 'Checked out',
  'team.ON_LEAVE': 'On leave',
  'team.NOT_IN': 'Not in yet',
  'pay.title': 'Payroll',
  'pay.desc': 'Salary structures and monthly payslips calculated from attendance and unpaid leave.',
  'pay.runs': 'Payroll runs',
  'pay.structures': 'Salary structures',
  'pay.generate': 'Generate payroll',
  'pay.publish': 'Publish',
  'pay.rules': 'Statutory rules',
  'pay.adjustments': 'Adjustments',
  'nav.payslips': 'My payslips',
  'nav.profile': 'My profile',
  'nav.org': 'Organisation',
  'nav.import': 'Bulk import',
  'nav.roles': 'Roles',
  'let.title': 'Letters',
  'let.desc':
    'Issue offer, experience and other letters from templates. Employees read them in the app.',
  'let.issued': 'Issued letters',
  'let.templates': 'Templates',
  'let.issue': 'Issue a letter',
  'hb.title': 'HR handbook',
  'hb.desc': 'Company policies. Only published sections are visible to employees.',
  'hb.add': 'Add section',
} as const;
export type Key = keyof typeof en;

export const hi: Record<Key, string> = {
  'nav.dashboard': 'डैशबोर्ड',
  'nav.attendance': 'उपस्थिति',
  'nav.approvals': 'अनुमोदन',
  'nav.leave': 'छुट्टी',
  'nav.employees': 'कर्मचारी',
  'nav.team': 'आज की टीम',
  'nav.departments': 'विभाग',
  'nav.designations': 'पदनाम',
  'nav.requests': 'अनुरोध',
  'nav.workflows': 'अनुमोदन प्रवाह',
  'nav.shifts': 'शिफ़्ट',
  'nav.locations': 'स्थान',
  'nav.holidays': 'अवकाश',
  'nav.payroll': 'पेरोल',
  'nav.letters': 'पत्र',
  'nav.handbook': 'एचआर हैंडबुक',
  'nav.reports': 'रिपोर्ट',
  'nav.audit': 'ऑडिट लॉग',
  'nav.settings': 'सेटिंग्स',
  'group.overview': 'सारांश',
  'group.workforce': 'कार्यबल',
  'group.hr': 'एचआर और वेतन',
  'group.setup': 'कंपनी सेटअप',
  'group.insights': 'जानकारी',
  'group.admin': 'प्रशासन',
  'common.language': 'भाषा',
  'common.save': 'सहेजें',
  'common.cancel': 'रद्द करें',
  'common.add': 'जोड़ें',
  'common.edit': 'बदलें',
  'common.status': 'स्थिति',
  'team.title': 'आज की टीम',
  'team.desc':
    'कौन काम कर रहा है, ब्रेक पर है, छुट्टी पर है या अभी आया नहीं। हर मिनट अपडेट होता है।',
  'team.search': 'नाम से खोजें',
  'team.all': 'सभी',
  'team.WORKING': 'काम पर',
  'team.ON_BREAK': 'ब्रेक पर',
  'team.CHECKED_OUT': 'चेक आउट',
  'team.ON_LEAVE': 'छुट्टी पर',
  'team.NOT_IN': 'अभी नहीं आए',
  'pay.title': 'पेरोल',
  'pay.desc': 'वेतन संरचना और मासिक वेतन पर्ची, उपस्थिति और बिना वेतन की छुट्टी के आधार पर।',
  'pay.runs': 'पेरोल रन',
  'pay.structures': 'वेतन संरचना',
  'pay.generate': 'पेरोल बनाएँ',
  'pay.publish': 'प्रकाशित करें',
  'pay.rules': 'वैधानिक नियम',
  'pay.adjustments': 'समायोजन',
  'nav.payslips': 'मेरी वेतन पर्चियाँ',
  'nav.profile': 'मेरी प्रोफ़ाइल',
  'nav.org': 'संगठन',
  'nav.import': 'बल्क इम्पोर्ट',
  'nav.roles': 'भूमिकाएँ',
  'let.title': 'पत्र',
  'let.desc': 'टेम्पलेट से ऑफ़र, अनुभव और अन्य पत्र जारी करें। कर्मचारी इन्हें ऐप में पढ़ते हैं।',
  'let.issued': 'जारी किए गए पत्र',
  'let.templates': 'टेम्पलेट',
  'let.issue': 'पत्र जारी करें',
  'hb.title': 'एचआर हैंडबुक',
  'hb.desc': 'कंपनी की नीतियाँ। कर्मचारियों को केवल प्रकाशित अनुभाग दिखते हैं।',
  'hb.add': 'अनुभाग जोड़ें',
};

export const LANGUAGES = [
  { code: 'en', native: 'English' },
  { code: 'hi', native: 'हिन्दी' },
] as const;
export type Lang = (typeof LANGUAGES)[number]['code'];
export const DICTIONARIES: Record<Lang, Record<Key, string>> = { en, hi };
const STORE = 'wf.lang';

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: Key) => string;
}
const Ctx = createContext<I18n>({ lang: 'en', setLang: () => undefined, t: (k) => en[k] });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(STORE);
      if (v === 'en' || v === 'hi') setLangState(v);
    } catch {
      /* storage blocked: keep English */
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(STORE, l);
    } catch {
      /* ignore */
    }
  }, []);
  const value = useMemo<I18n>(
    () => ({ lang, setLang, t: (k) => DICTIONARIES[lang][k] ?? en[k] }),
    [lang, setLang],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useI18n = () => useContext(Ctx);
