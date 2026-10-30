'use client';
import { PageTop } from '@/components/page-top';
import { useAuth } from '@/components/auth';
import { Alert, Card } from '@/components/ui/display';
import { BankIds } from '../employees/bank-ids';
import { ProfileItems } from '../employees/profile-items';

export default function MyProfilePage() {
  const { active } = useAuth();
  return (
    <>
      <PageTop
        scope="your profile"
        title="My profile"
        description="Your bank and ID details (masked), qualifications, previous employment, certifications and skills. HR marks entries as verified after checking them; changing a verified entry makes it unverified again."
      />
      {active?.employeeId ? (
        <>
          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">Bank and ID details</h2>
            <BankIds emp={{ id: active.employeeId }} />
            <p className="text-xs text-muted">
              Shown masked. To change these details, ask HR; they cannot be edited from your own account.
            </p>
          </Card>
          <ProfileItems employeeId={active.employeeId} canVerify={false} />
        </>
      ) : (
        <Alert tone="warn">Your account has no employee record.</Alert>
      )}
    </>
  );
}
