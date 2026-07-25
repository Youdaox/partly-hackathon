/**
 * Send to customer.
 *
 * One job: hand over a link. The QR is the whole point of the screen, so it gets the space,
 * and everything else is a single line of summary underneath.
 *
 * This used to print every part with every supplier option — 22 parts times three offers,
 * which is 66 rows the repairer has already reviewed on the previous screen and which the
 * customer is about to see properly on their own page. The counts and the price range say
 * the same thing in one line, and the parts are one tap away if they are wanted.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { formatPrice } from '@partli/shared';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, ErrorNotice, Loading } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
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
  const [showParts, setShowParts] = useState(false);
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
        await Share.share({ message: `Your repair options are ready: ${url}`, url });
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

  /**
   * The price range the customer will actually be choosing between: cheapest offer per part
   * against genuine-where-one-exists. Derived, so it can never claim a spread the quote does
   * not contain.
   */
  const range = useMemo(() => {
    const lines = quote.data?.lines ?? [];
    let low = 0;
    let high = 0;
    for (const line of lines) {
      if (line.options.length === 0) continue;
      const prices = line.options.map((o) => o.price_nzd);
      const genuine = line.options.filter((o) => o.tier === 'oem').map((o) => o.price_nzd);
      low += Math.min(...prices) * line.qty;
      high += (genuine.length ? Math.min(...genuine) : Math.max(...prices)) * line.qty;
    }
    return { low, high };
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

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.list}>
        {error ? <ErrorNotice title={error.title} detail={error.detail} /> : null}

        <ThemedText type="heading" style={styles.heading}>
          Ready to send
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.sub}>
          Have the customer scan this with their phone camera.
        </ThemedText>

        {/* The QR gets the room. Always on white so it scans off a dim screen. */}
        <View style={styles.qrWrap}>
          <View style={styles.qrSurface}>
            <QRCode value={result.approval_url} size={220} backgroundColor="#ffffff" />
          </View>
        </View>

        <Pressable onPress={share} accessibilityRole="button" style={styles.linkWrap}>
          <ThemedText type="small" style={[styles.link, { color: theme.accent }]} numberOfLines={1}>
            {result.approval_url}
          </ThemedText>
        </Pressable>

        <Button
          title={Platform.OS === 'web' ? (copied ? 'Copied' : 'Copy link') : 'Share link'}
          variant={copied ? 'success' : 'secondary'}
          onPress={share}
          fullWidth
        />

        {/* One line instead of 66 rows. */}
        <View style={[styles.summary, { borderTopColor: theme.border, borderBottomColor: theme.border }]}>
          <View style={styles.summaryRow}>
            <ThemedText type="rowTitle">{result.lines.length} parts</ThemedText>
            <ThemedText type="rowTitle">
              {formatPrice(range.low)}
              {range.high > range.low ? ` – ${formatPrice(range.high)}` : ''}
            </ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            The customer picks from three plans: best price, our recommendation, or all
            genuine parts.
          </ThemedText>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => setShowParts((open) => !open)}
          style={({ pressed }) => [styles.disclosure, { opacity: pressed ? 0.6 : 1 }]}
        >
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            {showParts ? 'Hide the parts' : 'See the parts'}
          </ThemedText>
        </Pressable>

        {showParts
          ? result.lines.map((item) => (
              <View key={item.part_id} style={[styles.partRow, { borderBottomColor: theme.border }]}>
                <ThemedText type="small" style={styles.partName} numberOfLines={2}>
                  {item.qty > 1 ? `${item.qty}× ` : ''}
                  {item.display_name}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {item.options.length
                    ? formatPrice(Math.min(...item.options.map((o) => o.price_nzd)) * item.qty)
                    : '—'}
                </ThemedText>
              </View>
            ))
          : null}

        <View style={styles.actions}>
          <Button title="Back to the assessment" onPress={() => router.back()} fullWidth />
          <Button
            title="Rebuild quote"
            variant="secondary"
            onPress={resend}
            loading={resending}
            fullWidth
          />
        </View>

        <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
          Simulated pricing — the dataset ships no price, stock or supplier data.
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  padded: { padding: Spacing.three },
  retry: { marginTop: Spacing.three },
  list: {
    padding: Spacing.three,
    gap: Spacing.three,
    paddingBottom: Spacing.five,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },

  heading: { textAlign: 'center' },
  sub: { textAlign: 'center', marginTop: -Spacing.two },

  qrWrap: { alignItems: 'center', paddingVertical: Spacing.two },
  qrSurface: { backgroundColor: '#ffffff', padding: Spacing.three, borderRadius: Radius.card },

  linkWrap: { alignItems: 'center' },
  link: { textAlign: 'center' },

  summary: {
    gap: Spacing.one,
    paddingVertical: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },

  disclosure: { alignSelf: 'center', minHeight: 30, justifyContent: 'center' },
  partRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  partName: { flex: 1 },

  actions: { gap: Spacing.two, marginTop: Spacing.two },
  footnote: { textAlign: 'center' },
});
