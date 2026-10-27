import { Suspense } from 'react';
import { SetPassword } from '@/components/set-password';

export default function Page() {
  return (
    <Suspense>
      <SetPassword
        title="Choose a new password"
        endpoint="/auth/reset-password"
        doneText="Your password was changed and other sessions were signed out."
      />
    </Suspense>
  );
}
