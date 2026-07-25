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
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { formatPrice } from '@partli/shared';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, ErrorNotice, Loading } from '@/components/ui';
import { NoFocusRing, Radius, Spacing, TapTarget } from '@/constants/theme';
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
  const [email, setEmail] = useState('');
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
   * Email the link.
   *
   * This opens the phone's mail app with the message already written, rather than sending
   * from the server: there is no SMTP config, no mail provider and no credentials anywhere in
   * this build, so a "Sent" toast would be a lie. Handing off to the mail app genuinely
   * delivers, and it comes from the shop's own address, which is what a customer should see.
   */
  const emailLink = useCallback(async () => {
    const url = quote.data?.approval_url;
    if (!url) return;

    const to = email.trim();
    if (!to || !to.includes('@')) {
      setActionError({
        title: 'That does not look like an email address',
        detail: 'Enter the customer’s address, or use Copy link instead.',
      });
      return;
    }

    setActionError(null);
    const subject = 'Your repair options are ready';
    const body =
      `Hi,\n\nYour repair options are ready to review and approve:\n\n${url}\n\n` +
      `You can pick the plan that suits you — best price, our recommendation, or all ` +
      `genuine parts.\n`;
    const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;

    try {
      const opened = await Linking.canOpenURL(mailto);
      if (!opened) throw new Error('No mail app is set up on this device');
      await Linking.openURL(mailto);
    } catch (err) {
      setActionError(toErrorInfo(err));
    }
  }, [quote.data, email]);

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

        {/* Email it instead, for a customer who is not standing at the counter. */}
        <View style={styles.emailRow}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="customer@email.com"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            inputMode="email"
            onSubmitEditing={emailLink}
            returnKeyType="send"
            style={[
              styles.emailInput,
              { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement },
              NoFocusRing,
            ]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Email the link to the customer"
            onPress={emailLink}
            disabled={!email.trim()}
            style={({ pressed }) => [
              styles.emailSend,
              {
                backgroundColor: email.trim() ? theme.accent : theme.backgroundSelected,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Ionicons
              name="mail-outline"
              size={20}
              color={email.trim() ? theme.accentText : theme.textSecondary}
            />
          </Pressable>
        </View>
        <ThemedText type="small" themeColor="textSecondary" style={styles.emailNote}>
          Opens your mail app with the link written, so it comes from the shop&apos;s address.
        </ThemedText>

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
          {/* Re-prices the quote against the current report and reissues the same link.
              Named for what it does: the old "Rebuild quote" read like it might discard
              something. */}
          <Button
            title="Update the quote"
            variant="secondary"
            onPress={resend}
            loading={resending}
            fullWidth
          />
          <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
            Re-prices against any parts you have confirmed since. The link stays the same.
          </ThemedText>
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

  emailRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  emailInput: {
    flex: 1,
    fontSize: 16,
    minHeight: TapTarget - 8,
    paddingHorizontal: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.round,
  },
  emailSend: {
    width: TapTarget - 8,
    height: TapTarget - 8,
    borderRadius: Radius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emailNote: { textAlign: 'center', marginTop: -Spacing.two },

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
