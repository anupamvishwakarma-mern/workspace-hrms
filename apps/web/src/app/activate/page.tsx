import { Suspense } from 'react';
import { SetPassword } from '@/components/set-password';

export default function Page() {
  return (
    <Suspense>
      <SetPassword
        title="Activate your account"
        endpoint="/auth/activate"
        doneText="Your account is active. You can sign in now."
      />
    </Suspense>
  );
}
