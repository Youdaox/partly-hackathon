/**
 * Screen 4 — send to customer.
 *
 * Builds the quote, then shows the shareable link as a QR code so the customer can
 * scan it off the repairer's phone and approve on their own device.
 */

import { useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { formatPrice } from '@partli/shared';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, Card, ErrorNotice, Loading, Pill } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { toErrorInfo, useAsyncData } from '@/hooks/use-async-data';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';

export default function SendToCustomerScreen() {
  const { id: jobId } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();

  // Sending on mount is the point of this screen — there is nothing to configure.
  const quote = useAsyncData(() => api.sendToCustomer(jobId), [jobId]);

  const [resending, setResending] = useState(false);
  const [actionError, setActionError] = useState<{ title: string; detail?: string } | null>(null);

  const resend = useCallback(async () => {
    setResending(true);
    setActionError(null);
    try {
      quote.setData(await api.sendToCustomer(jobId));
    } catch (err) {
      setActionError(toErrorInfo(err));
    } finally {
      setResending(false);
    }
  }, [jobId, quote]);

  const share = useCallback(async () => {
    if (!quote.data) return;
    await Share.share({
      message: `Your repair options are ready: ${quote.data.approvalUrl}`,
      url: quote.data.approvalUrl,
    });
  }, [quote.data]);

  if (quote.loading) {
    return (
      <ThemedView style={styles.container}>
        <Loading label="Building the quote…" />
      </ThemedView>
    );
  }

  if (!quote.data) {
    const error = actionError ?? quote.error;
    return (
      <ThemedView style={styles.container}>
        <View style={styles.padded}>
          {error ? <ErrorNotice title={error.title} detail={error.detail} /> : null}
          <View style={styles.retry}>
            <Button title="Try again" onPress={resend} loading={resending} fullWidth />
          </View>
        </View>
      </ThemedView>
    );
  }

  const result = quote.data;
  const error = actionError ?? quote.error;

  const total = result.lineItems.reduce((sum, item) => {
    // Show the cheapest option per part, since that is what an unsure customer sees first.
    const cheapest = Math.min(...item.options.map((option) => option.priceCents));
    return sum + cheapest;
  }, 0);

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.list}>
        {error ? <ErrorNotice title={error.title} detail={error.detail} /> : null}

        <Card style={styles.qrCard}>
          <ThemedText type="smallBold">Have the customer scan this</ThemedText>
          <View style={styles.qrWrapper}>
            {/* QR renders on a white square so it scans reliably in dark mode. */}
            <View style={styles.qrSurface}>
              <QRCode value={result.approvalUrl} size={200} backgroundColor="#ffffff" />
            </View>
          </View>
          <Pressable onPress={share} accessibilityRole="button">
            <ThemedText type="small" style={{ color: theme.accent }}>
              {result.approvalUrl}
            </ThemedText>
          </Pressable>
          <Button
            title={Platform.OS === 'web' ? 'Copy link' : 'Share link'}
            variant="secondary"
            onPress={share}
            fullWidth
          />
        </Card>

        <View style={styles.sectionHeader}>
          <ThemedText type="smallBold">Quote</ThemedText>
          <Pill label={`${result.lineItems.length} parts`} tone="accent" />
        </View>

        {result.lineItems.map((item) => (
          <Card key={item.partId} style={styles.card}>
            <View style={styles.itemHeader}>
              <ThemedText type="smallBold" style={styles.itemName}>
                {item.displayName}
              </ThemedText>
              {item.kind === 'hidden' ? <Pill label="Hidden" tone="success" /> : null}
            </View>
            {item.options.map((option) => (
              <View key={option.id} style={styles.optionRow}>
                <ThemedText type="small" themeColor="textSecondary">
                  {option.label}
                </ThemedText>
                <ThemedText type="small">
                  {formatPrice(option.priceCents, option.currency)} · {option.etaDays}d
                </ThemedText>
              </View>
            ))}
          </Card>
        ))}

        <Card>
          <View style={styles.optionRow}>
            <ThemedText type="smallBold">Cheapest total</ThemedText>
            <ThemedText type="smallBold">{formatPrice(total)}</ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Placeholder pricing — no supplier data ships with the hackathon dataset.
          </ThemedText>
        </Card>

        <Button
          title="Rebuild quote"
          variant="secondary"
          onPress={resend}
          loading={resending}
          fullWidth
        />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  padded: { padding: Spacing.three },
  retry: { marginTop: Spacing.three },
  list: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.five },
  qrCard: { alignItems: 'center', gap: Spacing.three },
  qrWrapper: { alignItems: 'center' },
  qrSurface: { backgroundColor: '#ffffff', padding: Spacing.three, borderRadius: Spacing.two },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  card: { gap: Spacing.one },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  itemName: { flex: 1 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
});
