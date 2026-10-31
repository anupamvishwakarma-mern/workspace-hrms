'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import {
  Consent,
  Field,
  Honeypot,
  Input,
  Select,
  StatusBanner,
  Textarea,
  useSubmit,
} from './fields';
import { Button } from '@/components/ui/button';
import { services } from '@/config/services';
import { track } from '@/lib/analytics/track';
import {
  CONTACT_TYPES,
  EMPLOYEE_BANDS,
  HOSTING,
  INDUSTRIES,
  PARTNER_TYPES,
  PLANS,
  TIME_SLOTS,
  contactSchema,
  demoSchema,
  partnerSchema,
  serviceSchema,
  type ContactInput,
  type DemoInput,
  type PartnerInput,
  type ServiceInput,
} from '@/lib/validation/schemas';

const privacy = (
  <>
    I agree to be contacted about my request and have read the{' '}
    <Link href="/privacy-policy" className="text-link underline">
      Privacy Policy
    </Link>
    .
  </>
);

function Done({ title, text }: { title: string; text: string }) {
  return (
    <StatusBanner tone="success" title={title}>
      {text}
    </StatusBanner>
  );
}
function ServerError({ message }: { message: string }) {
  return (
    <StatusBanner tone="error" title="We could not send your request">
      {message}
    </StatusBanner>
  );
}

function useLead<T extends object>(
  endpoint: string,
  schema: Parameters<typeof zodResolver>[0],
  defaults: Partial<T>,
  onOk?: () => void,
) {
  const { state, send } = useSubmit(endpoint);
  const form = useForm<T>({
    resolver: zodResolver(schema as never),
    defaultValues: defaults as never,
  });
  const submit = form.handleSubmit(async (v) => {
    const r = await send(v);
    if (r.ok) {
      onOk?.();
      form.reset();
    } else if (r.body && typeof r.body.fields === 'object') {
      for (const [k, m] of Object.entries(r.body.fields as Record<string, string>))
        form.setError(k as never, { message: m });
    }
  });
  return { form, state, submit };
}

export function DemoForm() {
  const today = new Date().toISOString().slice(0, 10);
  const {
    form: f,
    state,
    submit,
  } = useLead<DemoInput>(
    '/api/demo',
    demoSchema,
    { plan: 'Not sure yet', hosting: 'Not sure yet' },
    () => track('demo_form_submit'),
  );
  const e = f.formState.errors;
  if (state.phase === 'done')
    return (
      <Done
        title="Thanks. Your demo request has been received."
        text="Our team will contact you to confirm a time. Check your email for follow-up."
      />
    );
  return (
    <form
      onSubmit={submit}
      noValidate
      className="relative space-y-5"
      aria-describedby="demo-status"
    >
      <Honeypot {...f.register('website' as never)} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Full name" required error={e.fullName?.message}>
          {(p) => <Input autoComplete="name" {...p} {...f.register('fullName')} />}
        </Field>
        <Field label="Work email" required error={e.email?.message}>
          {(p) => <Input type="email" autoComplete="email" {...p} {...f.register('email')} />}
        </Field>
        <Field label="Phone number" error={e.phone?.message}>
          {(p) => <Input type="tel" autoComplete="tel" {...p} {...f.register('phone')} />}
        </Field>
        <Field label="Company name" required error={e.companyName?.message}>
          {(p) => <Input autoComplete="organization" {...p} {...f.register('companyName')} />}
        </Field>
        <Field label="Job title" required error={e.jobTitle?.message}>
          {(p) => <Input autoComplete="organization-title" {...p} {...f.register('jobTitle')} />}
        </Field>
        <Field label="Number of employees" required error={e.employees?.message}>
          {(p) => (
            <Select defaultValue="" {...p} {...f.register('employees')}>
              <option value="" disabled>
                Select
              </option>
              {EMPLOYEE_BANDS.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Industry" required error={e.industry?.message}>
          {(p) => (
            <Select defaultValue="" {...p} {...f.register('industry')}>
              <option value="" disabled>
                Select
              </option>
              {INDUSTRIES.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Interested plan" error={e.plan?.message}>
          {(p) => (
            <Select {...p} {...f.register('plan')}>
              {PLANS.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Preferred date" required error={e.preferredDate?.message}>
          {(p) => <Input type="date" min={today} {...p} {...f.register('preferredDate')} />}
        </Field>
        <Field label="Preferred time" required error={e.preferredTime?.message}>
          {(p) => (
            <Select defaultValue="" {...p} {...f.register('preferredTime')}>
              <option value="" disabled>
                Select
              </option>
              {TIME_SLOTS.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Database hosting preference" error={e.hosting?.message}>
        {(p) => (
          <Select {...p} {...f.register('hosting')}>
            {HOSTING.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Additional requirements" error={e.notes?.message}>
        {(p) => <Textarea {...p} {...f.register('notes')} />}
      </Field>
      <Consent error={e.consent?.message} {...f.register('consent')}>
        {privacy}
      </Consent>
      <div id="demo-status" aria-live="polite">
        {state.phase === 'error' ? <ServerError message={state.message} /> : null}
      </div>
      <Button type="submit" size="lg" className="w-full" loading={state.phase === 'sending'}>
        Book my demo
      </Button>
    </form>
  );
}

export function ContactForm({ initialType }: { initialType?: string }) {
  const first = (CONTACT_TYPES as readonly string[]).includes(initialType ?? '')
    ? (initialType as ContactInput['type'])
    : undefined;
  const {
    form: f,
    state,
    submit,
  } = useLead<ContactInput>('/api/leads/contact', contactSchema, first ? { type: first } : {});
  const e = f.formState.errors;
  if (state.phase === 'done')
    return (
      <Done
        title="Message received."
        text="Thanks for getting in touch. We will reply as soon as we can."
      />
    );
  return (
    <form onSubmit={submit} noValidate className="relative space-y-5">
      <Honeypot {...f.register('website' as never)} />
      <Field label="What is this about?" required error={e.type?.message}>
        {(p) => (
          <Select defaultValue={first ?? ''} {...p} {...f.register('type')}>
            <option value="" disabled>
              Select
            </option>
            {CONTACT_TYPES.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </Select>
        )}
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Your name" required error={e.fullName?.message}>
          {(p) => <Input autoComplete="name" {...p} {...f.register('fullName')} />}
        </Field>
        <Field label="Email" required error={e.email?.message}>
          {(p) => <Input type="email" autoComplete="email" {...p} {...f.register('email')} />}
        </Field>
        <Field label="Phone" error={e.phone?.message}>
          {(p) => <Input type="tel" autoComplete="tel" {...p} {...f.register('phone')} />}
        </Field>
        <Field label="Company" error={e.companyName?.message}>
          {(p) => <Input autoComplete="organization" {...p} {...f.register('companyName')} />}
        </Field>
      </div>
      <Field label="Message" required error={e.message?.message}>
        {(p) => <Textarea rows={6} {...p} {...f.register('message')} />}
      </Field>
      <Consent error={e.consent?.message} {...f.register('consent')}>
        {privacy}
      </Consent>
      <div aria-live="polite">
        {state.phase === 'error' ? <ServerError message={state.message} /> : null}
      </div>
      <Button type="submit" size="lg" loading={state.phase === 'sending'}>
        Send message
      </Button>
    </form>
  );
}

export function ServiceEnquiryForm({ initialService }: { initialService?: string }) {
  const valid = services.some((s) => s.id === initialService) ? initialService : undefined;
  const {
    form: f,
    state,
    submit,
  } = useLead<ServiceInput>('/api/leads/service', serviceSchema, valid ? { serviceId: valid } : {});
  const e = f.formState.errors;
  if (state.phase === 'done')
    return (
      <Done
        title="Enquiry received."
        text="We will review your requirements and reply with next steps. Scope and pricing are agreed per engagement."
      />
    );
  return (
    <form onSubmit={submit} noValidate className="relative space-y-5" id="enquiry">
      <Honeypot {...f.register('website' as never)} />
      <Field label="Service" required error={e.serviceId?.message}>
        {(p) => (
          <Select defaultValue={valid ?? ''} {...p} {...f.register('serviceId')}>
            <option value="" disabled>
              Select a service
            </option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Your name" required error={e.fullName?.message}>
          {(p) => <Input autoComplete="name" {...p} {...f.register('fullName')} />}
        </Field>
        <Field label="Work email" required error={e.email?.message}>
          {(p) => <Input type="email" autoComplete="email" {...p} {...f.register('email')} />}
        </Field>
        <Field label="Phone" error={e.phone?.message}>
          {(p) => <Input type="tel" autoComplete="tel" {...p} {...f.register('phone')} />}
        </Field>
        <Field label="Company name" required error={e.companyName?.message}>
          {(p) => <Input autoComplete="organization" {...p} {...f.register('companyName')} />}
        </Field>
      </div>
      <Field label="Company size" required error={e.employees?.message}>
        {(p) => (
          <Select defaultValue="" {...p} {...f.register('employees')}>
            <option value="" disabled>
              Select
            </option>
            {EMPLOYEE_BANDS.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="What do you need?" required error={e.details?.message}>
        {(p) => <Textarea rows={5} {...p} {...f.register('details')} />}
      </Field>
      <Consent error={e.consent?.message} {...f.register('consent')}>
        {privacy}
      </Consent>
      <div aria-live="polite">
        {state.phase === 'error' ? <ServerError message={state.message} /> : null}
      </div>
      <Button type="submit" size="lg" loading={state.phase === 'sending'}>
        Send enquiry
      </Button>
    </form>
  );
}

export function PartnerForm() {
  const { form: f, state, submit } = useLead<PartnerInput>('/api/leads/partner', partnerSchema, {});
  const e = f.formState.errors;
  if (state.phase === 'done')
    return (
      <Done
        title="Application received."
        text="Thank you. We will review it and get back to you. Commercial terms are shared once the programme is finalised."
      />
    );
  return (
    <form onSubmit={submit} noValidate className="relative space-y-5">
      <Honeypot {...f.register('website' as never)} />
      <Field label="Partnership type" required error={e.partnerType?.message}>
        {(p) => (
          <Select defaultValue="" {...p} {...f.register('partnerType')}>
            <option value="" disabled>
              Select
            </option>
            {PARTNER_TYPES.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </Select>
        )}
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Your name" required error={e.fullName?.message}>
          {(p) => <Input autoComplete="name" {...p} {...f.register('fullName')} />}
        </Field>
        <Field label="Work email" required error={e.email?.message}>
          {(p) => <Input type="email" autoComplete="email" {...p} {...f.register('email')} />}
        </Field>
        <Field label="Company name" required error={e.companyName?.message}>
          {(p) => <Input autoComplete="organization" {...p} {...f.register('companyName')} />}
        </Field>
        <Field label="Company website" error={e.companyUrl?.message}>
          {(p) => <Input type="url" placeholder="https://" {...p} {...f.register('companyUrl')} />}
        </Field>
      </div>
      <Field label="Tell us about your business" required error={e.about?.message}>
        {(p) => <Textarea rows={5} {...p} {...f.register('about')} />}
      </Field>
      <Consent error={e.consent?.message} {...f.register('consent')}>
        {privacy}
      </Consent>
      <div aria-live="polite">
        {state.phase === 'error' ? <ServerError message={state.message} /> : null}
      </div>
      <Button type="submit" size="lg" loading={state.phase === 'sending'}>
        Submit application
      </Button>
    </form>
  );
}
