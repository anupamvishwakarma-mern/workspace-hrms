import {
  BookOpen,
  Cable,
  Database,
  DatabaseZap,
  GraduationCap,
  HardDriveUpload,
  LayoutDashboard,
  LifeBuoy,
  Rocket,
  Server,
  Settings2,
  type LucideIcon,
} from 'lucide-react';

/** Professional services are sold separately from the SaaS subscription. Scope and pricing are agreed per engagement. */
export interface Service {
  id: string;
  name: string;
  icon: LucideIcon;
  description: string;
  benefits: string[];
  useCases: string[];
}

export const services: Service[] = [
  {
    id: 'implementation',
    name: 'HRMS Implementation',
    icon: Rocket,
    description:
      'Guided setup of your company workspace: locations, shifts, leave policy, roles and settings.',
    benefits: ['Faster go-live', 'Policies configured correctly', 'Fewer rollout surprises'],
    useCases: ['New customers moving from spreadsheets', 'Multi-location rollouts'],
  },
  {
    id: 'data-migration',
    name: 'Employee Data Migration',
    icon: HardDriveUpload,
    description:
      'Clean and import your existing employee data using the platform’s validated import tools.',
    benefits: ['Fewer data errors', 'Less manual entry', 'Clear import report'],
    useCases: ['Moving from another HR tool', 'Consolidating several spreadsheets'],
  },
  {
    id: 'workflow-customization',
    name: 'HR Workflow Customization',
    icon: Settings2,
    description:
      'Adapt approvals, leave rules and attendance policies to how your company works, within the product’s configuration options.',
    benefits: ['Fits your process', 'Fewer workarounds'],
    useCases: ['Unusual leave policies', 'Specific approval routes'],
  },
  {
    id: 'custom-reports',
    name: 'Custom Reports and Dashboards',
    icon: LayoutDashboard,
    description: 'Reports built to your management questions, delivered as exports or dashboards.',
    benefits: ['Answers leadership actually asks for', 'Less manual spreadsheet work'],
    useCases: ['Monthly management packs', 'Finance reconciliation'],
  },
  {
    id: 'mongodb-configuration',
    name: 'MongoDB Database Configuration',
    icon: Database,
    description:
      'Help preparing your own MongoDB for use with the platform: version, replica set, user permissions and network access.',
    benefits: ['A verified connection the first time', 'Least-privilege database user'],
    useCases: ['Customer-owned database onboarding', 'Security-reviewed setups'],
  },
  {
    id: 'dedicated-database',
    name: 'Dedicated Database Setup',
    icon: DatabaseZap,
    description: 'Discuss dedicated database infrastructure arrangements for your company.',
    benefits: ['Isolation beyond the shared cluster', 'Capacity planned for your size'],
    useCases: ['Large headcounts', 'Contractual isolation needs'],
  },
  {
    id: 'enterprise-deployment',
    name: 'Enterprise Deployment Assistance',
    icon: Server,
    description:
      'Support for deploying and operating the platform in your own environment, subject to agreement.',
    benefits: ['Fewer deployment risks', 'Clear runbooks'],
    useCases: ['Private cloud deployments', 'Security and network reviews'],
  },
  {
    id: 'integrations',
    name: 'Custom Integrations',
    icon: Cable,
    description: 'Connect the platform to your existing systems using its API.',
    benefits: ['Less double entry', 'Systems stay in sync'],
    useCases: ['Directory or accounting sync', 'Data feeds to analytics tools'],
  },
  {
    id: 'training',
    name: 'Training and Onboarding',
    icon: GraduationCap,
    description: 'Training sessions for administrators, managers and employees.',
    benefits: ['Higher adoption', 'Fewer support questions'],
    useCases: ['Admin training before go-live', 'Manager walkthroughs'],
  },
  {
    id: 'support',
    name: 'Technical Support',
    icon: LifeBuoy,
    description: 'Support beyond the standard plan, as agreed in a support arrangement.',
    benefits: ['Faster responses', 'A known contact'],
    useCases: ['Business-critical rollouts', 'Ongoing advisory'],
  },
];
export const serviceIcons = { BookOpen };
