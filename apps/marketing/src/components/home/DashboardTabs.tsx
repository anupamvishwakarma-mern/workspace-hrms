import { Tabs } from '@/components/ui/tabs';
import { Section, SectionHeader } from '@/components/ui/primitives';
import {
  DashboardMockup,
  AttendancePreview,
  DirectoryPreview,
  LeavePreview,
  ShiftPreview,
  AnalyticsPreview,
} from '@/components/mockups/Previews';

export function DashboardTabs() {
  return (
    <Section tone="surface" id="preview">
      <SectionHeader
        eyebrow="Product preview"
        title="See the platform in action"
        text="Illustrative interface previews using sample data. Book a demo to see the real application."
      />
      <div className="mx-auto mt-10 max-w-4xl">
        <Tabs
          label="Product previews"
          tabs={[
            { id: 'dashboard', label: 'HR dashboard', content: <DashboardMockup /> },
            { id: 'directory', label: 'Employee directory', content: <DirectoryPreview /> },
            { id: 'attendance', label: 'Attendance', content: <AttendancePreview /> },
            { id: 'leave', label: 'Leave approvals', content: <LeavePreview /> },
            { id: 'shifts', label: 'Shift calendar', content: <ShiftPreview /> },
            { id: 'analytics', label: 'Analytics', content: <AnalyticsPreview /> },
          ]}
        />
      </div>
    </Section>
  );
}
