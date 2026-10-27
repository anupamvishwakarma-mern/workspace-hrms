import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Image, Linking, Text, View } from 'react-native';
import { useAuth } from '@/auth/AuthProvider';
import {
  Badge,
  Banner,
  Body,
  Button,
  Card,
  Eyebrow,
  Field,
  Loading,
  PageHeader,
  Screen,
  Stat,
  toneForStatus,
} from '@/components/ui';
import { PhotoStep, PlaceLine, PunchDetails } from '@/components/proof';
import { useToday } from '@/hooks/queries';
import { api } from '@/lib/client';
import { ApiError, isGeoFailure, userMessage, type GeoErrorDetails } from '@/lib/errors';
import { EVENT_LABEL, formatMinutes, formatTime } from '@/lib/format';
import { LOCATION_MESSAGES, LocationError } from '@/lib/location';
import {
  PHOTO_MESSAGES,
  PhotoError,
  capturePhoto,
  type CapturedPhoto,
  type Facing,
} from '@/lib/photo';
import { performPunch, type PunchResult } from '@/lib/punchFlow';
import type { AllowedAction, EventType } from '@/lib/schemas';
import { useTheme } from '@/theme';
import { useT } from '@/prefs';
import type { Key } from '@/i18n';

const BUTTON_LABEL: Record<EventType, Key> = {
  CHECK_IN: 'today.checkIn',
  CHECK_OUT: 'today.checkOut',
  BREAK_START: 'today.breakStart',
  BREAK_END: 'today.breakEnd',
};

interface GeoPrompt {
  action: EventType;
  message: string;
  allowRequest: boolean;
}

export default function Today() {
  const tr = useT();
  const t = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { active } = useAuth();
  const today = useToday();
  const [notice, setNotice] = useState<{ tone: 'success' | 'info'; text: string }>();
  const [error, setError] = useState<{ text: string; openSettings?: boolean }>();
  const [geo, setGeo] = useState<GeoPrompt>();
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string>();
  // Photo step: which punch is waiting for a photo, and the photo taken for it.
  const [proof, setProof] = useState<{ action: EventType; photo?: CapturedPhoto }>();
  const [proofError, setProofError] = useState<{ text: string; openSettings?: boolean }>();
  const [last, setLast] = useState<{
    result: Extract<PunchResult, { kind: 'RECORDED' }>;
    photo?: CapturedPhoto;
  }>();

  const punch = useMutation({
    mutationFn: (v: { action: EventType; reason?: string; photo?: CapturedPhoto }) =>
      performPunch(api, v.action, v.reason, v.photo),
    onMutate: () => {
      setError(undefined);
      setNotice(undefined);
    },
    onSuccess: (res: PunchResult, v) => {
      setGeo(undefined);
      setProof(undefined);
      setProofError(undefined);
      setLast(res.kind === 'RECORDED' ? { result: res, photo: v.photo } : undefined);
      setReason('');
      setNotice(
        res.kind === 'PENDING_REVIEW'
          ? {
              tone: 'info',
              text: `${EVENT_LABEL[res.eventType]} request sent for approval. It is not recorded until a reviewer approves it.`,
            }
          : {
              tone: 'success',
              text: res.replayed
                ? `${EVENT_LABEL[res.eventType]} was already recorded.`
                : `${EVENT_LABEL[res.eventType]}.`,
            },
      );
      void qc.invalidateQueries({ queryKey: ['today'] });
      void qc.invalidateQueries({ queryKey: ['history'] });
      void qc.invalidateQueries({ queryKey: ['exceptions'] });
    },
    onError: (e, v) => {
      if (e instanceof ApiError && e.code.startsWith('PHOTO_')) {
        // The photo was refused: keep the step open with a fresh capture needed.
        setProof({ action: v.action });
        setProofError({ text: userMessage(e) });
        void qc.invalidateQueries({ queryKey: ['today'] });
        return;
      }
      if (e instanceof PhotoError) {
        setProofError({
          text: PHOTO_MESSAGES[e.kind],
          openSettings: e.kind === 'PERMISSION_DENIED' && !e.canAskAgain,
        });
        return;
      }
      if (isGeoFailure(e)) {
        const d = (e.details ?? {}) as GeoErrorDetails;
        const extra =
          e.code === 'OUTSIDE_GEOFENCE' && d.distanceMeters
            ? ` (about ${Math.round(d.distanceMeters)} m away)`
            : '';
        setGeo({
          action: v.action,
          message: `${userMessage(e)}${extra}`,
          allowRequest: !!d.exceptionAllowed,
        });
        return;
      }
      setGeo(undefined);
      if (e instanceof LocationError)
        setError({
          text: LOCATION_MESSAGES[e.kind],
          openSettings: e.kind === 'PERMISSION_DENIED' && !e.canAskAgain,
        });
      else {
        setError({ text: userMessage(e) });
        // The state may have changed on the server (e.g. punched from another device): refresh it.
        if (e instanceof ApiError && e.code === 'INVALID_TRANSITION')
          void qc.invalidateQueries({ queryKey: ['today'] });
      }
    },
  });

  const needsPhoto = (t: EventType) =>
    !!today.data?.photoRequired && (t === 'CHECK_IN' || t === 'CHECK_OUT');

  const capture = async (facing: Facing) => {
    if (!proof) return;
    setProofError(undefined);
    try {
      const photo = await capturePhoto(facing);
      if (photo) setProof({ action: proof.action, photo });
    } catch (e) {
      if (e instanceof PhotoError)
        setProofError({
          text: PHOTO_MESSAGES[e.kind],
          openSettings: e.kind === 'PERMISSION_DENIED' && !e.canAskAgain,
        });
      else setProofError({ text: PHOTO_MESSAGES.UNAVAILABLE });
    }
  };

  const confirmAndPunch = (a: AllowedAction) => {
    setLast(undefined);
    if (needsPhoto(a.eventType)) {
      setProofError(undefined);
      setProof({ action: a.eventType });
      return;
    }
    const go = () => punch.mutate({ action: a.eventType });
    if (a.eventType === 'CHECK_OUT')
      Alert.alert(tr('today.checkOutTitle'), tr('today.checkOutBody'), [
        { text: tr('common.cancel'), style: 'cancel' },
        { text: tr('today.checkOut'), onPress: go },
      ]);
    else go();
  };

  const submitException = () => {
    if (!geo) return;
    const r = reason.trim();
    if (r.length < 5)
      return setReasonError('Explain why you need approval (at least 5 characters).');
    setReasonError(undefined);
    punch.mutate({ action: geo.action, reason: r, photo: proof?.photo });
  };

  if (today.isPending) return <Loading />;
  if (today.isError)
    return (
      <Screen onRefresh={() => void today.refetch()} refreshing={today.isRefetching}>
        <PageHeader title={tr('today.title')} />
        <Banner
          tone="danger"
          action={
            <Button
              title={tr('common.retry')}
              variant="secondary"
              onPress={() => void today.refetch()}
            />
          }
        >
          {userMessage(today.error)}
        </Banner>
      </Screen>
    );

  const d = today.data;
  const tz = d.timezone;
  const missingEmployee = !active?.employeeId;
  const sum = d.summary;

  return (
    <Screen onRefresh={() => void today.refetch()} refreshing={today.isRefetching}>
      <PageHeader
        title={tr('today.title')}
        subtitle={`${active?.tenantName ?? ''}${
          d.shift
            ? ` · ${d.shift.name} ${d.shift.startTime}–${d.shift.endTime}`
            : ` · ${tr('today.noShift')}`
        }`}
      />

      {missingEmployee ? (
        <Banner tone="warn">
          Your account has no employee profile in this company, so you cannot record attendance.
          Contact HR.
        </Banner>
      ) : null}
      {d.previousSessionIncomplete ? (
        <Banner
          tone="warn"
          action={
            <Button
              title={tr('att.requestCorrection')}
              variant="secondary"
              onPress={() =>
                router.push({
                  pathname: '/correction/new',
                  params: { workDate: d.previousSessionIncomplete?.workDate ?? '' },
                })
              }
            />
          }
        >
          A previous session
          {d.previousSessionIncomplete.workDate
            ? ` (${d.previousSessionIncomplete.workDate})`
            : ''}{' '}
          was never checked out. Ask for a correction so it is counted properly.
        </Banner>
      ) : null}
      {notice ? <Banner tone={notice.tone}>{notice.text}</Banner> : null}
      {error ? (
        <Banner
          tone="danger"
          action={
            error.openSettings ? (
              <Button
                title="Open Settings"
                variant="secondary"
                onPress={() => void Linking.openSettings()}
              />
            ) : undefined
          }
        >
          {error.text}
        </Banner>
      ) : null}

      <Card tone={d.state === 'WORKING' ? 'accent' : undefined}>
        <Badge
          label={tr(`today.state.${d.state}` as Key)}
          tone={d.state === 'WORKING' ? 'success' : d.state === 'ON_BREAK' ? 'warn' : 'neutral'}
        />
        {d.openSince ? (
          <View style={{ gap: 2 }}>
            <Text style={{ color: t.text, fontSize: 40, fontWeight: '800', letterSpacing: -1 }}>
              {formatMinutes(d.currentSessionMinutes)}
            </Text>
            <Body muted>{tr('today.since', { time: formatTime(d.openSince, tz) })}</Body>
          </View>
        ) : (
          <View style={{ gap: 2 }}>
            <Text style={{ color: t.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 }}>
              {tr('today.ready')}
            </Text>
            <Body muted>{tr('today.notCheckedIn')}</Body>
          </View>
        )}
        {d.shift?.remainingMinutes !== undefined ? (
          <Body muted small>
            {tr('today.shiftLeft', { time: formatMinutes(d.shift.remainingMinutes) })}
          </Body>
        ) : null}
        <View style={{ gap: 10, marginTop: 8 }}>
          {d.allowedActions
            .filter((a) => a.enabled)
            .map((a) => (
              <Button
                key={a.eventType}
                size={a.eventType === 'CHECK_IN' || a.eventType === 'CHECK_OUT' ? 'lg' : 'md'}
                title={tr(BUTTON_LABEL[a.eventType])}
                variant={
                  a.eventType === 'CHECK_OUT'
                    ? 'danger'
                    : a.eventType === 'CHECK_IN'
                      ? 'primary'
                      : 'secondary'
                }
                disabled={missingEmployee || punch.isPending || !!geo || !!proof}
                loading={punch.isPending && punch.variables?.action === a.eventType}
                onPress={() => confirmAndPunch(a)}
                accessibilityHint="Reads your location once to verify you are at your work location"
              />
            ))}
        </View>
        <Body muted small>
          {tr('today.locationNote')}
        </Body>
      </Card>

      {proof && !geo ? (
        <PhotoStep
          actionLabel={tr(BUTTON_LABEL[proof.action])}
          photo={proof.photo}
          busy={punch.isPending}
          error={proofError}
          danger={proof.action === 'CHECK_OUT'}
          onCapture={(f) => void capture(f)}
          onConfirm={() => punch.mutate({ action: proof.action, photo: proof.photo })}
          onCancel={() => {
            setProof(undefined);
            setProofError(undefined);
          }}
        />
      ) : null}

      {last ? (
        <Card>
          <Eyebrow>Last punch</Eyebrow>
          {last.photo ? (
            <Image
              source={{ uri: last.photo.uri }}
              accessibilityLabel="Your proof photo"
              style={{ width: '100%', height: 180, borderRadius: 16 }}
              resizeMode="cover"
            />
          ) : null}
          <Body bold>
            {EVENT_LABEL[last.result.eventType]} · {formatTime(last.result.occurredAt, tz)}
          </Body>
          <PlaceLine
            place={last.result.location}
            name={d.events.find((e) => e.id === last.result.eventId)?.workLocationName}
          />
        </Card>
      ) : null}

      {geo ? (
        <Card>
          <Banner tone="warn">{geo.message}</Banner>
          {geo.allowRequest ? (
            <>
              <Body>
                If you are working from an approved place that GPS cannot confirm, you can ask a
                reviewer to approve this {tr(BUTTON_LABEL[geo.action]).toLowerCase()}.
              </Body>
              <ReasonInput value={reason} onChange={setReason} error={reasonError} />
              <Button
                title="Send for approval"
                onPress={submitException}
                loading={punch.isPending}
              />
            </>
          ) : (
            <Body muted>
              Your company does not allow approval requests for location problems. Move to your work
              location and try again.
            </Body>
          )}
          <Button
            title={tr('common.cancel')}
            variant="secondary"
            onPress={() => {
              setGeo(undefined);
              setProof(undefined);
            }}
            disabled={punch.isPending}
          />
        </Card>
      ) : null}

      <Eyebrow>{tr('today.soFar')}</Eyebrow>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Stat label={tr('today.worked')} value={formatMinutes(sum.workedMinutes)} />
        <Stat label={tr('today.breaks')} value={formatMinutes(sum.breakMinutes)} />
      </View>
      <Card>
        <Row
          label={tr('today.status')}
          value={sum.status ? tr(`status.${sum.status}` as Key) : '—'}
        />
        <Row label={tr('today.firstIn')} value={formatTime(sum.firstCheckIn, tz)} />
        <Row label={tr('today.lastOut')} value={formatTime(sum.lastCheckOut, tz)} />
        {sum.lateMinutes ? (
          <Row label={tr('today.lateBy')} value={formatMinutes(sum.lateMinutes)} />
        ) : null}
        {d.correctionStatus === 'PENDING' ? (
          <Badge label={tr('today.correctionPending')} tone={toneForStatus('PENDING')} />
        ) : null}
      </Card>

      <Eyebrow>{tr('today.punches')}</Eyebrow>
      <Card>
        {d.events.length === 0 ? (
          <Body muted>{tr('today.noPunches')}</Body>
        ) : (
          d.events.map((e) => (
            <View key={e.id} style={{ gap: 4 }}>
              <Row label={EVENT_LABEL[e.eventType]} value={formatTime(e.occurredAt, tz)} />
              <PunchDetails event={e} />
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: t.muted }}>{label}</Text>
      <Text style={{ color: t.text, fontWeight: '600' }}>{value}</Text>
    </View>
  );
}
function ReasonInput({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <Field
      label="Reason"
      value={value}
      onChangeText={onChange}
      error={error}
      multiline
      maxLength={500}
      placeholder="e.g. Client site visit, office GPS unavailable"
    />
  );
}
