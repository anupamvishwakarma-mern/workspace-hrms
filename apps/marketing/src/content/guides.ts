/** SAMPLE guides. Practical and generic; replace or extend when real guides are written. */
export interface Guide {
  slug: string;
  title: string;
  summary: string;
  steps: { title: string; text: string }[];
}

export const guides: Guide[] = [
  {
    slug: 'set-up-attendance',
    title: 'Set up attendance for your company',
    summary: 'From locations to shifts to your first check-in.',
    steps: [
      {
        title: 'Add your work locations',
        text: 'Create each office with its address and a geofence radius that allows for GPS accuracy.',
      },
      {
        title: 'Define a shift',
        text: 'Set start and end times, grace period, break policy and weekly offs.',
      },
      {
        title: 'Assign shifts to employees',
        text: 'Assign with an effective date so history stays accurate.',
      },
      {
        title: 'Decide your exception policy',
        text: 'Choose whether employees can request approval for out-of-fence punches.',
      },
      {
        title: 'Run a pilot',
        text: 'Have a small group punch in for a week and review the results.',
      },
    ],
  },
  {
    slug: 'write-a-leave-policy',
    title: 'Write and configure a leave policy',
    summary: 'Turn your written policy into leave types and allowances.',
    steps: [
      { title: 'List leave types', text: 'For example casual, sick and earned leave.' },
      { title: 'Set annual allowances', text: 'Decide the days per type and who is eligible.' },
      {
        title: 'Choose an approval route',
        text: 'Decide who approves and whether self-approval is ever allowed.',
      },
      {
        title: 'Add company holidays',
        text: 'Enter the holiday calendar so it is reflected in attendance.',
      },
    ],
  },
  {
    slug: 'import-employees',
    title: 'Import your employees',
    summary: 'Prepare a clean file and import it safely.',
    steps: [
      {
        title: 'Export from your current source',
        text: 'Use CSV or Excel with one row per employee.',
      },
      {
        title: 'Match the columns',
        text: 'Required columns are checked before anything is saved.',
      },
      { title: 'Fix reported issues', text: 'Correct rows the validation flags and re-upload.' },
      {
        title: 'Invite employees',
        text: 'Send activation invitations so people can set their passwords.',
      },
    ],
  },
  {
    slug: 'connect-your-mongodb',
    title: 'Connect your own MongoDB',
    summary: 'Prepare a customer-owned database for the platform.',
    steps: [
      {
        title: 'Check the version and topology',
        text: 'Use a supported MongoDB version running as a replica set.',
      },
      {
        title: 'Create an empty database and a dedicated user',
        text: 'Grant only the permissions needed to create collections, indexes and write data.',
      },
      {
        title: 'Allow network access',
        text: 'Allow our servers through your firewall or IP allow-list.',
      },
      {
        title: 'Use a TLS connection string',
        text: 'Use a mongodb+srv:// or TLS-enabled mongodb:// string.',
      },
      {
        title: 'Verify and save',
        text: 'The connection is tested end-to-end and stored encrypted. It is never shown again.',
      },
    ],
  },
  {
    slug: 'roll-out-the-mobile-app',
    title: 'Roll out the mobile app',
    summary: 'Get employees checking in smoothly.',
    steps: [
      { title: 'Announce the policy', text: 'Explain when to punch and why location is checked.' },
      { title: 'Invite employees', text: 'Make sure everyone has activated their account.' },
      {
        title: 'Run a first-week check',
        text: 'Review exceptions and adjust geofence radius if needed.',
      },
    ],
  },
  {
    slug: 'run-monthly-payroll',
    title: 'Run a monthly payroll',
    summary: 'From attendance review to publishing payslips.',
    steps: [
      {
        title: 'Review attendance',
        text: 'Resolve pending corrections and exceptions for the month.',
      },
      {
        title: 'Run payroll as draft',
        text: 'Check each figure against its salary structure and attendance.',
      },
      {
        title: 'Publish',
        text: 'Publish so employees can read their payslips. A separate publisher can be required.',
      },
    ],
  },
];
