import type { Post } from './types';

/**
 * SAMPLE CONTENT. Every article here is editorial placeholder text written to be generally accurate and
 * non-promotional. There are no fabricated experts, statistics or citations. Replace with real content and authors
 * (or load from a CMS in lib/integrations) when the editorial process exists.
 */
const author = { name: 'Editorial Team', role: 'Sample content' };

export const posts: Post[] = [
  {
    slug: 'what-is-hrms-and-how-does-it-work',
    title: 'What Is HRMS and How Does It Work?',
    category: 'HR basics',
    tags: ['hrms', 'basics', 'hr software'],
    author,
    date: '2026-09-01',
    readingMinutes: 5,
    featured: true,
    excerpt:
      'A plain-language explanation of what an HRMS is, what it replaces, and how its modules fit together.',
    body: [
      {
        t: 'p',
        text: 'A Human Resource Management System (HRMS) is software that holds employee records and automates the routine processes around them: attendance, leave, scheduling, payroll inputs, documents and reporting.',
      },
      { t: 'h2', text: 'What an HRMS replaces' },
      {
        t: 'ul',
        items: [
          'Spreadsheets of employee details',
          'Paper or messaging-app attendance and leave',
          'Manual month-end calculations',
          'Scattered documents and letters',
        ],
      },
      { t: 'h2', text: 'How the pieces fit together' },
      {
        t: 'p',
        text: 'The employee record is the foundation. Attendance and leave feed payroll, shifts shape how attendance is classified, and reports summarise all of it. Roles and permissions decide who sees what.',
      },
      { t: 'h2', text: 'What to look for' },
      {
        t: 'p',
        text: 'Check that the modules you need exist today, not only on a roadmap, that employees can use it from a phone, and that you understand where your data is hosted.',
      },
    ],
  },
  {
    slug: 'hrms-vs-hris-vs-hcm',
    title: 'HRMS vs HRIS vs HCM',
    category: 'HR basics',
    tags: ['hrms', 'hris', 'hcm'],
    author,
    date: '2026-09-04',
    readingMinutes: 4,
    excerpt:
      'The three acronyms are used loosely. Here is how they usually differ and why it matters when you shop.',
    body: [
      {
        t: 'p',
        text: 'Vendors use HRIS, HRMS and HCM interchangeably, but there is a common pattern.',
      },
      {
        t: 'ul',
        items: [
          'HRIS: the system of record for employee data and core administration.',
          'HRMS: an HRIS plus operational modules such as attendance, leave and payroll.',
          'HCM: the broadest term, adding talent areas such as recruiting, performance and workforce planning.',
        ],
      },
      { t: 'h2', text: 'Which should you evaluate?' },
      {
        t: 'p',
        text: 'Ignore the label and list the processes you need to run. Then confirm each one exists in the product you are evaluating and ask for a demo of those exact workflows.',
      },
    ],
  },
  {
    slug: 'how-to-manage-employee-attendance',
    title: 'How to Manage Employee Attendance',
    category: 'Attendance',
    tags: ['attendance', 'policy'],
    author,
    date: '2026-09-08',
    readingMinutes: 6,
    featured: true,
    excerpt:
      'A practical framework: define the policy, capture punches reliably, handle exceptions, and review the data.',
    body: [
      { t: 'h2', text: '1. Write a clear policy' },
      {
        t: 'p',
        text: 'Define working hours, grace periods, how breaks are treated, and what counts as late, half day or absent. Put it in writing and share it.',
      },
      { t: 'h2', text: '2. Capture punches reliably' },
      {
        t: 'p',
        text: 'Use a method that is hard to dispute: a server-recorded timestamp and, where relevant, a location check. Avoid relying on a device clock.',
      },
      { t: 'h2', text: '3. Plan for exceptions' },
      {
        t: 'p',
        text: 'Phones die and networks fail. Provide a correction request that a manager approves, rather than silent edits.',
      },
      { t: 'h2', text: '4. Review regularly' },
      {
        t: 'ul',
        items: [
          'Weekly: late and absent patterns by team',
          'Monthly: reconcile with leave and payroll inputs',
          'Quarterly: review whether the policy still fits',
        ],
      },
    ],
  },
  {
    slug: 'gps-attendance-and-geofencing-explained',
    title: 'GPS Attendance and Geofencing Explained',
    category: 'Attendance',
    tags: ['gps', 'geofencing', 'mobile'],
    author,
    date: '2026-09-12',
    readingMinutes: 5,
    featured: true,
    excerpt:
      'How location-based check-in works, what a geofence is, and the privacy questions to settle first.',
    body: [
      {
        t: 'p',
        text: 'GPS attendance records where an employee was when they punched in or out. A geofence is a virtual boundary, usually a radius around an office, that the location is compared against.',
      },
      { t: 'h2', text: 'How it works' },
      {
        t: 'ul',
        items: [
          'The employee taps check-in in the app',
          'The app reads one location',
          'The server compares it to the configured office radius and records the result',
        ],
      },
      { t: 'h2', text: 'Limits to be aware of' },
      {
        t: 'p',
        text: 'GPS accuracy varies indoors, so allow a sensible radius and an exception route for genuine edge cases.',
      },
      { t: 'h2', text: 'Privacy' },
      {
        t: 'p',
        text: 'Collect location only at the moment of a punch, say so in your policy, and set a retention period for raw coordinates.',
      },
    ],
  },
  {
    slug: 'benefits-of-automated-leave-management',
    title: 'Benefits of Automated Leave Management',
    category: 'Leave',
    tags: ['leave', 'automation'],
    author,
    date: '2026-09-15',
    readingMinutes: 4,
    excerpt: 'What changes when leave requests, approvals and balances live in one system.',
    body: [
      {
        t: 'ul',
        items: [
          'Balances stay correct because approvals update them automatically',
          'Managers see team context before approving',
          'Employees check status without asking HR',
          'Policy rules live in one place, not in personal spreadsheets',
        ],
      },
      {
        t: 'p',
        text: 'The biggest practical gain is fewer disputes: everyone sees the same balance and the same history.',
      },
      { t: 'h2', text: 'What to automate first' },
      {
        t: 'p',
        text: 'Start with request and approval, then add accrual and carry-forward once the basics are trusted.',
      },
    ],
  },
  {
    slug: 'how-to-choose-the-right-hrms',
    title: 'How to Choose the Right HRMS',
    category: 'HR basics',
    tags: ['buying guide', 'hrms'],
    author,
    date: '2026-09-18',
    readingMinutes: 6,
    excerpt: 'A checklist for evaluating HRMS software without being swayed by feature lists.',
    body: [
      { t: 'h2', text: 'Start from your processes' },
      { t: 'p', text: 'List what HR does every week and every month. Rank them by pain.' },
      { t: 'h2', text: 'Questions to ask every vendor' },
      {
        t: 'ul',
        items: [
          'Which of these features exist today, and which are planned?',
          'Where is our data stored and who can access it?',
          'Can we export our data if we leave?',
          'How are roles and permissions handled?',
          'What does implementation involve and what does it cost?',
        ],
      },
      { t: 'h2', text: 'Run a real pilot' },
      {
        t: 'p',
        text: 'Use your own policies and a small group of employees. A short pilot reveals more than any demo.',
      },
    ],
  },
  {
    slug: 'managed-mongodb-vs-customer-owned-mongodb',
    title: 'Managed MongoDB vs Customer-Owned MongoDB',
    category: 'Infrastructure',
    tags: ['mongodb', 'hosting', 'infrastructure'],
    author,
    date: '2026-09-22',
    readingMinutes: 6,
    featured: true,
    excerpt: 'Who runs, backs up and pays for the database in each model, and how to choose.',
    body: [
      {
        t: 'p',
        text: 'With a managed database the vendor hosts, monitors and provisions the database for you. With a customer-owned database you provide your own MongoDB and the application connects to it.',
      },
      { t: 'h2', text: 'Choose managed when' },
      {
        t: 'ul',
        items: [
          'You want the simplest setup',
          'You do not want to administer a database',
          'Your policies do not require data to sit in your own infrastructure',
        ],
      },
      { t: 'h2', text: 'Choose customer-owned when' },
      {
        t: 'ul',
        items: [
          'Policy or contract requires you to control the database',
          'You already operate MongoDB and its backups',
          'You want your own network and access controls',
        ],
      },
      { t: 'h2', text: 'Responsibilities differ' },
      {
        t: 'p',
        text: 'Backup, availability and recovery for a customer-owned database are yours unless you contract otherwise, and you pay your database provider directly. Switching later needs a planned migration, not a toggle.',
      },
    ],
  },
  {
    slug: 'why-employee-self-service-matters',
    title: 'Why Employee Self-Service Matters',
    category: 'HR basics',
    tags: ['self-service', 'employee experience'],
    author,
    date: '2026-09-25',
    readingMinutes: 4,
    excerpt:
      'Letting employees handle routine requests themselves frees HR for work that needs judgement.',
    body: [
      {
        t: 'p',
        text: 'Most HR requests are routine: check a leave balance, download a payslip, correct a punch, read a policy. When employees can do these themselves, HR spends less time answering and more time on people issues.',
      },
      {
        t: 'ul',
        items: [
          'Faster answers for employees',
          'Fewer interruptions for HR',
          'A clear audit trail for each request',
        ],
      },
      { t: 'h2', text: 'Make it easy to adopt' },
      {
        t: 'p',
        text: 'A mobile app and a simple first-run experience matter more than a long feature list.',
      },
    ],
  },
  {
    slug: 'hr-automation-for-small-businesses',
    title: 'HR Automation for Small Businesses',
    category: 'Small business',
    tags: ['small business', 'automation'],
    author,
    date: '2026-09-28',
    readingMinutes: 5,
    excerpt: 'Where a small team gets the most value from automating HR first.',
    body: [
      { t: 'h2', text: 'Automate these first' },
      {
        t: 'ul',
        items: [
          'Attendance capture',
          'Leave requests and balances',
          'Employee records and documents',
        ],
      },
      { t: 'h2', text: 'Then' },
      {
        t: 'p',
        text: 'Once attendance is trustworthy, feed it into payroll inputs. Keep the process simple and add rules only when a real need appears.',
      },
    ],
  },
  {
    slug: 'employee-data-security-best-practices',
    title: 'Employee Data Security Best Practices',
    category: 'Security',
    tags: ['security', 'privacy', 'data'],
    author,
    date: '2026-10-02',
    readingMinutes: 6,
    excerpt: 'Practical habits for protecting employee data, whichever HR system you use.',
    body: [
      {
        t: 'ul',
        items: [
          'Give people the minimum access their job needs',
          'Keep sensitive documents in private storage, never public links',
          'Require strong passwords and review who has admin roles',
          'Keep an audit trail of important changes',
          'Set retention periods and delete data you no longer need',
          'Ask vendors how credentials and backups are protected',
        ],
      },
      {
        t: 'p',
        text: 'No product makes you secure on its own. Policies, training and regular reviews matter as much as the software.',
      },
    ],
  },
];

export const postBySlug = (slug: string) => posts.find((p) => p.slug === slug);
export const categories = [...new Set(posts.map((p) => p.category))];
export const allTags = [...new Set(posts.flatMap((p) => p.tags))].sort();
