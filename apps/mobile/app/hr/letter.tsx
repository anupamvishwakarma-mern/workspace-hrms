import { useLocalSearchParams } from 'expo-router';
import { Share, Text } from 'react-native';
import { QueryGate } from '@/components/state';
import { Banner, Body, Button, Card, PageHeader, Screen } from '@/components/ui';
import { useLetter } from '@/hooks/queries';
import { formatWorkDate } from '@/lib/format';
import { useT } from '@/prefs';
import { useTheme } from '@/theme';

export default function LetterDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const tr = useT();
  const q = useLetter(String(id));
  return (
    <Screen underHeader>
      <QueryGate q={q}>
        {(l) => (
          <>
            <PageHeader
              title={l.title}
              subtitle={`${tr('let.ref', { ref: l.referenceNo })} · ${formatWorkDate(l.issuedAt.slice(0, 10))}`}
            />
            {l.status === 'REVOKED' ? (
              <Banner tone="danger">
                {tr('let.revokedNote', { reason: l.revokeReason ?? '—' })}
              </Banner>
            ) : null}
            <Card>
              {/* Plain text only: company-written text is never interpreted as markup. */}
              <Text selectable style={{ color: t.text, fontSize: 15, lineHeight: 24 }}>
                {l.body ?? ''}
              </Text>
            </Card>
            <Button
              title={tr('common.share')}
              variant="secondary"
              onPress={() =>
                void Share.share({ title: l.title, message: `${l.title}\n\n${l.body ?? ''}` })
              }
            />
            <Body muted small>
              {l.referenceNo}
            </Body>
          </>
        )}
      </QueryGate>
    </Screen>
  );
}
