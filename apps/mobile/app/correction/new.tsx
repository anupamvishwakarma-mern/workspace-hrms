import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, Text, View } from 'react-native';
import { Banner, Body, Button, Card, Field, Screen } from '@/components/ui';
import { useToday } from '@/hooks/queries';
import { api } from '@/lib/client';
import { userMessage } from '@/lib/errors';
import { buildCorrectionPayload, correctionSchema, type CorrectionForm } from '@/lib/forms';
import { correctionRecord } from '@/lib/schemas';
import { useTheme } from '@/theme';

export default function NewCorrection() {
  const t = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { workDate } = useLocalSearchParams<{ workDate?: string }>();
  const tz = useToday().data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [error, setError] = useState<string>();

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CorrectionForm>({
    resolver: zodResolver(correctionSchema),
    defaultValues: {
      workDate: workDate ?? '',
      checkIn: '',
      checkOut: '',
      checkOutNextDay: false,
      reason: '',
    },
  });
  const nextDay = watch('checkOutNextDay');

  const send = useMutation({
    mutationFn: async (v: CorrectionForm) => {
      const body = buildCorrectionPayload(v, tz);
      return (
        await api.call({
          method: 'POST',
          path: '/attendance/corrections',
          body,
          schema: correctionRecord,
        })
      ).data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['corrections'] });
      void qc.invalidateQueries({ queryKey: ['today'] });
      void qc.invalidateQueries({ queryKey: ['history'] });
      router.back();
    },
    onError: (e) => setError(e instanceof Error && !('status' in e) ? e.message : userMessage(e)),
  });

  return (
    <Screen>
      <Body muted>
        Original punches are never changed. A reviewer approves or rejects this request, and
        approved times replace the day's first check-in and/or last check-out in the calculation.
      </Body>
      <Card>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Controller
          control={control}
          name="workDate"
          render={({ field }) => (
            <Field
              label="Date (YYYY-MM-DD)"
              value={field.value}
              onChangeText={field.onChange}
              error={errors.workDate?.message}
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />
          )}
        />
        <Controller
          control={control}
          name="checkIn"
          render={({ field }) => (
            <Field
              label={`Check-in time (24h HH:MM, ${tz})`}
              value={field.value}
              onChangeText={field.onChange}
              error={errors.checkIn?.message}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              placeholder="09:00"
            />
          )}
        />
        <Controller
          control={control}
          name="checkOut"
          render={({ field }) => (
            <Field
              label="Check-out time (24h HH:MM)"
              value={field.value}
              onChangeText={field.onChange}
              error={errors.checkOut?.message}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              placeholder="18:00"
            />
          )}
        />
        <Pressable
          onPress={() => setValue('checkOutNextDay', !nextDay)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: nextDay }}
          style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 }}
        >
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: 7,
              borderWidth: 2,
              borderColor: nextDay ? t.primary : t.border,
              backgroundColor: nextDay ? t.primary : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {nextDay ? (
              <Text style={{ color: t.primaryText, fontWeight: '800', fontSize: 14 }}>✓</Text>
            ) : null}
          </View>
          <Text style={{ color: t.text, flex: 1 }}>
            Check-out was on the next day (overnight shift)
          </Text>
        </Pressable>
        <Controller
          control={control}
          name="reason"
          render={({ field }) => (
            <Field
              label="Reason"
              value={field.value}
              onChangeText={field.onChange}
              error={errors.reason?.message}
              multiline
              maxLength={1000}
            />
          )}
        />
        <Button
          title="Submit request"
          onPress={() => void handleSubmit((v) => send.mutate(v))()}
          loading={send.isPending}
        />
      </Card>
    </Screen>
  );
}
