/**
 * Screen 4 — send to customer.
 *
 * Builds the quote, then shows the shareable link as a QR code so the customer can
 * scan it off the repairer's phone and approve on their own device.
 */

import { useCallback, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { formatLeadTime, formatPrice } from '@partli/shared';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, Card, ErrorNotice, Loading, Pill } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { toErrorInfo, useAsyncData } from '@/hooks/use-async-data';
import { useTheme } from '@/hooks/use-theme';
import { backend } from '@/lib/backend';

export default function SendToCustomerScreen() {
  const { id: caseId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();

  // Sending on mount is the point of this screen — there is nothing to configure.
  const quote = useAsyncData(() => backend.sendToCustomer(caseId), [caseId]);

  const [resending, setResending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<{ title: string; detail?: string } | null>(null);

  const resend = useCallback(async () => {
    setResending(true);
    setActionError(null);
    try {
      quote.setData(await backend.sendToCustomer(caseId));
    } catch (err) {
      setActionError(toErrorInfo(err));
    } finally {
      setResending(false);
    }
  }, [caseId, quote]);

  /**
   * Hand the link over.
   *
   * Web and native need different things. `navigator.share` needs a secure context, throws
   * if an earlier share is still open, and rejects when the sheet is dismissed — so on web
   * this copies instead, which is what the button has always said it does.
   *
   * `navigator.clipboard` is itself unavailable over plain http on a LAN address, so there
   * is an execCommand fallback for exactly the case this demo runs in.
   */
  const busy = useRef(false);

  const share = useCallback(async () => {
    const url = quote.data?.approval_url;
    // The guard is the fix for "an earlier share has not yet completed": the link and the
    // button both call this, and a double tap used to start a second share.
    if (!url || busy.current) return;
    busy.current = true;
    setActionError(null);

    try {
      if (Platform.OS === 'web') {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
        } else {
          // Non-secure context: no Clipboard API. A throwaway textarea still works.
          const field = document.createElement('textarea');
          field.value = url;
          field.style.position = 'fixed';
          field.style.opacity = '0';
          document.body.appendChild(field);
          field.select();
          document.execCommand('copy');
          document.body.removeChild(field);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        await Share.share({
          message: `Your repair options are ready: ${url}`,
          url,
        });
      }
    } catch (err) {
      // Dismissing the share sheet rejects with AbortError. Not worth reporting.
      if (!(err instanceof Error) || err.name !== 'AbortError') {
        setActionError(toErrorInfo(err));
      }
    } finally {
      busy.current = false;
    }
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

  const total = result.lines.reduce((sum, item) => {
    // Show the cheapest option per part, since that is what an unsure customer sees first.
    if (item.options.length === 0) return sum;
    const cheapest = Math.min(...item.options.map((option) => option.price_nzd));
    return sum + cheapest * item.qty;
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
              <QRCode value={result.approval_url} size={200} backgroundColor="#ffffff" />
            </View>
          </View>
          <Pressable onPress={share} accessibilityRole="button">
            <ThemedText type="small" style={{ color: theme.accent }}>
              {result.approval_url}
            </ThemedText>
          </Pressable>
          <Button
            title={
              Platform.OS === 'web' ? (copied ? 'Copied' : 'Copy link') : 'Share link'
            }
            variant={copied ? 'success' : 'secondary'}
            onPress={share}
            fullWidth
          />
        </Card>

        <View style={styles.sectionHeader}>
          <ThemedText type="smallBold">Quote</ThemedText>
          <Pill label={`${result.lines.length} parts`} tone="accent" />
        </View>

        {result.lines.map((item) => (
          <Card key={item.part_id} style={styles.card}>
            <View style={styles.itemHeader}>
              <ThemedText type="smallBold" style={styles.itemName}>
                {item.qty > 1 ? `${item.qty}\u00d7 ` : ''}
                {item.display_name}
              </ThemedText>
              {item.kind === 'hidden' ? <Pill label="Predicted" tone="success" /> : null}
            </View>
            {item.options.map((option) => (
              <View key={option.id} style={styles.optionRow}>
                <ThemedText type="small" themeColor="textSecondary">
                  {option.label}
                </ThemedText>
                <ThemedText type="small">
                  {formatPrice(option.price_nzd)} · {formatLeadTime(option.lead_days)}
                  {option.in_stock ? '' : ' · backorder'}
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
            Simulated pricing — the dataset ships no price, stock or supplier data.
          </ThemedText>
        </Card>

        <Button
          title="Rebuild quote"
          variant="secondary"
          onPress={resend}
          loading={resending}
          fullWidth
        />

        {/* Rebuilding stays on this screen — this is the way back to the assessment. */}
        <Button title="Back to the assessment" onPress={() => router.back()} fullWidth />
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
