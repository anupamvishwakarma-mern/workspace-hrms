export interface Faq {
  q: string;
  a: string;
  category: 'General' | 'Pricing' | 'Database hosting' | 'Security' | 'Mobile';
}

export const faqs: Faq[] = [
  {
    category: 'General',
    q: 'What does the platform include today?',
    a: 'Employee management, GPS attendance with geofencing, leave, shifts, payroll runs and payslips, documents, letters and handbook, reports, role-based access, and a mobile app. Performance management is planned and not available yet.',
  },
  {
    category: 'General',
    q: 'Is there a free trial?',
    a: 'You can create a company workspace from the free trial page. Trial length and limits are set by the platform operator and are confirmed on signup.',
  },
  {
    category: 'General',
    q: 'Can we see a demo first?',
    a: 'Yes. Book a demo and tell us your team size and requirements.',
  },
  {
    category: 'Pricing',
    q: 'How is pricing calculated?',
    a: 'Plans are priced per employee per month, with annual billing available. Amounts on this website are illustrative until confirmed. Enterprise is quoted.',
  },
  {
    category: 'Pricing',
    q: 'Do you accept online payment?',
    a: 'Not on this website. Plan selection leads to a trial or to our sales team, and billing is arranged in an order form.',
  },
  {
    category: 'Pricing',
    q: 'Is GST included?',
    a: 'Prices are shown before GST. GST is added at the applicable rate.',
  },
  {
    category: 'Database hosting',
    q: 'Can I use my existing MongoDB database?',
    a: 'You can connect your own MongoDB that meets the requirements: a supported version, a replica set, network access for our servers, and a database user with the needed permissions. The target database must be empty or already belong to your company.',
  },
  {
    category: 'Database hosting',
    q: 'Who manages database backups?',
    a: 'With the managed database, backups follow your plan’s backup policy. With a customer-owned database, backup and recovery are your responsibility unless you contract otherwise.',
  },
  {
    category: 'Database hosting',
    q: 'Can I switch hosting options later?',
    a: 'Switching needs a controlled migration process. It is not an instant configuration toggle. Contact us to plan it.',
  },
  {
    category: 'Database hosting',
    q: 'Is my company data isolated?',
    a: 'Each company has its own database, and every request is scoped to the signed-in company membership. Customer-owned databases are fully separate infrastructure.',
  },
  {
    category: 'Database hosting',
    q: 'Who pays for database infrastructure?',
    a: 'For the managed database, hosting is covered as described in your plan. For a customer-owned database you pay your MongoDB provider directly.',
  },
  {
    category: 'Database hosting',
    q: 'Can enterprise customers request dedicated infrastructure?',
    a: 'Yes, dedicated infrastructure options can be discussed for Enterprise customers.',
  },
  {
    category: 'Security',
    q: 'Do you hold security certifications?',
    a: 'We do not claim any certification on this website. Ask us about our current security practices and documentation during a security review.',
  },
  {
    category: 'Security',
    q: 'How are customer database credentials protected?',
    a: 'Connection strings are verified, encrypted at rest, never displayed again and never returned by any API. Only the company owner can replace them.',
  },
  {
    category: 'Mobile',
    q: 'Does the mobile app work offline?',
    a: 'Not today. Offline attendance and push notifications are on the roadmap.',
  },
  {
    category: 'Mobile',
    q: 'Do you support biometric attendance?',
    a: 'Not today. Attendance uses GPS verification against your office geofence.',
  },
];
