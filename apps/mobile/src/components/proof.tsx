import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Image, Linking, Text, View } from 'react-native';
import { Banner, Body, Button, Card, Eyebrow } from '@/components/ui';
import { api } from '@/lib/client';
import { userMessage } from '@/lib/errors';
import { formatCoords, mapUrl } from '@/lib/maps';
import type { CapturedPhoto, Facing } from '@/lib/photo';
import { photoView, type PunchEvent } from '@/lib/schemas';
import { useTheme } from '@/theme';

type Place = { latitude: number; longitude: number; accuracyMeters?: number };

/** Where a punch was recorded, with a button that opens the phone's maps app. */
export function PlaceLine({ place, name }: { place: Place; name?: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {name ? <Body bold>{name}</Body> : null}
      <Text style={{ color: t.muted, fontSize: 13 }}>
        {formatCoords(place.latitude, place.longitude)}
        {place.accuracyMeters !== undefined
          ? ` · accurate to ~${Math.round(place.accuracyMeters)} m`
          : ''}
      </Text>
      <Button
        title="Open in Maps"
        variant="ghost"
        onPress={() => void Linking.openURL(mapUrl(place.latitude, place.longitude))}
        accessibilityHint="Opens this location in your maps app"
      />
    </View>
  );
}

/** Step shown before a punch when the company requires a photo: take it, check it, then confirm. */
export function PhotoStep({
  actionLabel,
  photo,
  busy,
  error,
  onCapture,
  onConfirm,
  onCancel,
  danger,
}: {
  actionLabel: string;
  photo?: CapturedPhoto;
  busy: boolean;
  error?: { text: string; openSettings?: boolean };
  onCapture: (facing: Facing) => void;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}) {
  const t = useTheme();
  return (
    <Card>
      <Eyebrow>Photo proof</Eyebrow>
      <Body bold>Take a photo to {actionLabel.toLowerCase()}</Body>
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
      {photo ? (
        <Image
          source={{ uri: photo.uri }}
          accessibilityLabel="Your proof photo"
          style={{ width: '100%', height: 260, borderRadius: 16, backgroundColor: t.subtle }}
          resizeMode="cover"
        />
      ) : (
        <Body muted small>
          Use the front camera for a selfie, or the back camera to show your surroundings. The photo
          is taken only now and is not saved to your gallery.
        </Body>
      )}
      {photo ? (
        <>
          <Button
            title={`Confirm ${actionLabel.toLowerCase()}`}
            variant={danger ? 'danger' : 'primary'}
            size="lg"
            loading={busy}
            onPress={onConfirm}
            accessibilityHint="Uploads the photo, reads your location once and records the punch"
          />
          <Button
            title="Retake"
            variant="secondary"
            disabled={busy}
            onPress={() => onCapture('front')}
          />
        </>
      ) : (
        <>
          <Button
            title="Take selfie"
            size="lg"
            disabled={busy}
            onPress={() => onCapture('front')}
          />
          <Button
            title="Use back camera"
            variant="secondary"
            disabled={busy}
            onPress={() => onCapture('back')}
          />
        </>
      )}
      <Button title="Cancel" variant="ghost" disabled={busy} onPress={onCancel} />
    </Card>
  );
}

/** Expandable details for one recorded punch: where it was recorded and, if taken, its photo. */
export function PunchDetails({ event }: { event: PunchEvent }) {
  const [open, setOpen] = useState(false);
  const photo = useQuery({
    queryKey: ['punch-photo', event.id],
    enabled: open && event.hasPhoto,
    staleTime: 30_000, // signed URLs last 60 s; refetch after that
    queryFn: async () =>
      (
        await api.call({
          method: 'GET',
          path: `/attendance/events/${event.id}/photo`,
          schema: photoView,
        })
      ).data.url,
  });
  if (!event.location && !event.hasPhoto) return null;
  return (
    <View style={{ gap: 8 }}>
      <Button
        title={open ? 'Hide details' : 'Location & photo'}
        variant="ghost"
        onPress={() => setOpen((o) => !o)}
      />
      {open ? (
        <View style={{ gap: 10 }}>
          {event.location ? (
            <PlaceLine place={event.location} name={event.workLocationName} />
          ) : (
            <Body muted small>
              Location details are removed after the retention period.
            </Body>
          )}
          {event.hasPhoto ? (
            photo.isPending ? (
              <Body muted small>
                Loading photo…
              </Body>
            ) : photo.isError ? (
              <Body muted small>
                {userMessage(photo.error)}
              </Body>
            ) : (
              <Image
                source={{ uri: photo.data }}
                accessibilityLabel="Proof photo for this punch"
                style={{ width: '100%', height: 220, borderRadius: 16 }}
                resizeMode="cover"
              />
            )
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
