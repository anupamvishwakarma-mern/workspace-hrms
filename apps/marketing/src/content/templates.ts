/** Only files that really exist under /public/templates are listed here. */
export interface Template {
  title: string;
  description: string;
  file: string;
  format: string;
}

export const templates: Template[] = [
  {
    title: 'Attendance policy template',
    description: 'A starting point for your written attendance policy.',
    file: '/templates/attendance-policy-template.md',
    format: 'Markdown',
  },
  {
    title: 'Leave policy template',
    description: 'Leave types, approval and carry-forward in one document.',
    file: '/templates/leave-policy-template.md',
    format: 'Markdown',
  },
  {
    title: 'Employee onboarding checklist',
    description: 'From offer acceptance to the first month.',
    file: '/templates/employee-onboarding-checklist.md',
    format: 'Markdown',
  },
  {
    title: 'Employee information sheet',
    description: 'Column headings for collecting employee data in a spreadsheet.',
    file: '/templates/employee-information-sheet.csv',
    format: 'CSV',
  },
  {
    title: 'Shift schedule template',
    description: 'A weekly roster grid you can open in any spreadsheet.',
    file: '/templates/shift-schedule-template.csv',
    format: 'CSV',
  },
];
