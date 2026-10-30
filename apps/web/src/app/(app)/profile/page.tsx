'use client';
import { PageTop } from '@/components/page-top';
import { useAuth } from '@/components/auth';
import { Alert } from '@/components/ui/display';
import { ProfileItems } from '../employees/profile-items';

export default function MyProfilePage() {
  const { active } = useAuth();
  return (
    <>
      <PageTop
        scope="your profile"
        title="My profile"
        description="Your qualifications, previous employment, certifications and skills. HR marks entries as verified after checking them; changing a verified entry makes it unverified again."
      />
      {active?.employeeId ? (
        <ProfileItems employeeId={active.employeeId} canVerify={false} />
      ) : (
        <Alert tone="warn">Your account has no employee record.</Alert>
      )}
    </>
  );
}
