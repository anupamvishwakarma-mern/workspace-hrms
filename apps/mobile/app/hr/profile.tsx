import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useAuth } from '@/auth/AuthProvider';
import { KV, QueryGate } from '@/components/state';
import { SignOutButton } from '@/components/SignOutButton';
import { Avatar, Badge, Banner, Body, Button, Card, Eyebrow, Field, Screen } from '@/components/ui';
import { useMyEmployee } from '@/hooks/queries';
import { api } from '@/lib/client';
import { userMessage } from '@/lib/errors';
import { formatWorkDate } from '@/lib/format';
import type { EmployeeSelf } from '@/lib/schemas';
import { useT } from '@/prefs';

const PHONE = /^[0-9+()\-\s]{5,30}$/;

function EditForm({ e, onDone }: { e: EmployeeSelf; onDone: () => void }) {
  const tr = useT();
  const qc = useQueryClient();
  const [phone, setPhone] = useState(e.phone ?? '');
  const [line1, setLine1] = useState(e.address?.line1 ?? '');
  const [city, setCity] = useState(e.address?.city ?? '');
  const [state, setState] = useState(e.address?.state ?? '');
  const [postal, setPostal] = useState(e.address?.postalCode ?? '');
  const [error, setError] = useState<string>();
  const save = useMutation({
    mutationFn: async () =>
      api.call({
        method: 'PATCH',
        path: `/employees/${e.id}`,
        body: {
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          address: {
            line1: line1.trim(),
            city: city.trim(),
            state: state.trim(),
            postalCode: postal.trim(),
          },
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employee-self'] });
      onDone();
    },
    onError: (err) => setError(userMessage(err)),
  });
  return (
    <Card>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Field
        label={tr('pro.phone')}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />
      <Field label={tr('pro.addr1')} value={line1} onChangeText={setLine1} />
      <Field label={tr('pro.city')} value={city} onChangeText={setCity} />
      <Field label={tr('pro.state')} value={state} onChangeText={setState} />
      <Field label={tr('pro.postal')} value={postal} onChangeText={setPostal} />
      <Button
        title={tr('common.save')}
        loading={save.isPending}
        onPress={() => {
          setError(undefined);
          if (phone.trim() && !PHONE.test(phone.trim())) return setError(tr('pro.badPhone'));
          save.mutate();
        }}
      />
      <Button title={tr('common.cancel')} variant="ghost" onPress={onDone} />
    </Card>
  );
}

export default function Profile() {
  const tr = useT();
  const { active, memberships, selectCompany, email } = useAuth();
  const q = useMyEmployee();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!editing) return;
    setSaved(false);
  }, [editing]);

  const name = q.data ? `${q.data.firstName ?? ''} ${q.data.lastName ?? ''}`.trim() : '';
  const a = q.data?.address;
  const address = [a?.line1, a?.city, a?.state, a?.postalCode].filter(Boolean).join(', ');

  return (
    <Screen underHeader>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Avatar name={name || email || '?'} size={56} />
          <View style={{ flex: 1, gap: 2 }}>
            <Body bold>{name || email || ''}</Body>
            <Body muted small>
              {q.data?.designation ?? active?.tenantName ?? ''}
            </Body>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {active?.roles.map((r) => (
            <Badge key={r} label={r.replace('_', ' ')} tone="neutral" />
          ))}
        </View>
        <Body muted small>
          {tr('pro.rolesNote')}
        </Body>
      </Card>

      {saved ? <Banner tone="success">{tr('pro.saved')}</Banner> : null}

      {!active?.employeeId ? null : (
        <QueryGate q={q}>
          {(e) =>
            editing ? (
              <EditForm
                e={e}
                onDone={() => {
                  setEditing(false);
                  setSaved(true);
                }}
              />
            ) : (
              <>
                <Card>
                  <Eyebrow>{tr('pro.work')}</Eyebrow>
                  <KV label={tr('pro.code')} value={e.employeeCode ?? '—'} />
                  <KV label={tr('pro.designation')} value={e.designation ?? '—'} />
                  <KV label={tr('pro.type')} value={e.employmentType?.replace('_', ' ') ?? '—'} />
                  <KV
                    label={tr('pro.joined')}
                    value={e.joiningDate ? formatWorkDate(e.joiningDate.slice(0, 10)) : '—'}
                  />
                </Card>
                <Card>
                  <Eyebrow>{tr('pro.contact')}</Eyebrow>
                  <KV label={tr('pro.email')} value={e.workEmail ?? email ?? '—'} />
                  <KV label={tr('pro.phone')} value={e.phone || tr('common.notSet')} />
                  <KV label={tr('pro.address')} value={address || tr('common.notSet')} />
                  <Button
                    title={tr('pro.edit')}
                    variant="secondary"
                    onPress={() => setEditing(true)}
                  />
                </Card>
              </>
            )
          }
        </QueryGate>
      )}

      {memberships.length > 1 ? (
        <Card>
          <Eyebrow>{tr('pro.switch')}</Eyebrow>
          {memberships.map((m) => (
            <Pressable
              key={m.tenantId}
              disabled={m.tenantId === active?.tenantId}
              onPress={() => void selectCompany(m.tenantId)}
              accessibilityRole="button"
              style={{
                paddingVertical: 12,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderColor: '#94a3b833',
              }}
            >
              <Body bold={m.tenantId === active?.tenantId}>
                {m.tenantName ?? m.tenantId}
                {m.tenantId === active?.tenantId ? ` ${tr('pro.current')}` : ''}
              </Body>
            </Pressable>
          ))}
        </Card>
      ) : null}

      <Card>
        <Eyebrow>{tr('pro.privacy')}</Eyebrow>
        <Body small muted>
          {tr('pro.privacyBody')}
        </Body>
      </Card>
      <SignOutButton />
    </Screen>
  );
}
