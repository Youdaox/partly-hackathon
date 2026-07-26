/**
 * Send to customer.
 *
 * One job: get the approval link to the customer. Email is the way in — a customer is
 * usually not standing at the counter — with copy/share underneath for when they are.
 *
 * There was a QR code here. It only ever served someone holding the repairer's phone, and
 * it carried a real trap: the URL is built from whatever host the request arrived on, so a
 * QR generated in a desktop browser encodes `localhost` and cannot be scanned by anything.
 * A typed address has none of that.
 *
 * It also used to print every part with every supplier option — 22 parts times three
 * offers, which is 66 rows the repairer already reviewed and the customer is about to see
 * properly. The counts and the price range say the same thing in one line.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { formatPrice } from '@partli/shared';

import { IntakeComposer } from '@/components/intake-composer';
import {
  PageTitle,
  PrimaryButton,
  ScreenHeader,
  SecondaryButton,
  VehicleLine,
} from '@/components/system/primitives';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, ErrorNotice, Loading } from '@/components/ui';
import { Faces, Intake } from '@/constants/theme';
import { toErrorInfo, useAsyncData } from '@/hooks/use-async-data';
import { backend } from '@/lib/backend';

export default function SendToCustomerScreen() {
  const { id: caseId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  // Sending on mount is the point of this screen — there is nothing to configure.
  const quote = useAsyncData(() => backend.sendToCustomer(caseId), [caseId]);
  // Only for the header. Cheap, and it keeps the title consistent with the
  // report screen this was opened from.
  const detail = useAsyncData(() => backend.getCase(caseId), [caseId]);
  const vehicle = detail.data?.report?.vehicle ?? null;
  const vehicleTitle = vehicle
    ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.rego
    : '';

  const [resending, setResending] = useState(false);
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
        detail: 'Enter the customer’s address to send them the link.',
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
      <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: vehicleTitle, headerTitleAlign: 'center' }} />
        <Loading label="Building the quote…" />
      </ThemedView>
    );
  }

  if (!quote.data) {
    const error = actionError ?? quote.error;
    return (
      <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: vehicleTitle, headerTitleAlign: 'center' }} />
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

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScreenHeader onBack={() => router.back()} backLabel="Back to the assessment">
        <VehicleLine name={vehicleTitle} plate={vehicle?.rego} />
      </ScreenHeader>

      <ScrollView contentContainerStyle={styles.main} keyboardShouldPersistTaps="handled">
        <View style={styles.titleGroup}>
          <PageTitle size={40} style={styles.centredText}>Send to the customer</PageTitle>
          <ThemedText style={styles.body}>
            Email them the link and they can approve from their own phone.
          </ThemedText>
        </View>

        {error ? <ErrorNotice title={error.title} detail={error.detail} /> : null}

        <IntakeComposer
          value={email}
          onChangeText={setEmail}
          onSubmit={emailLink}
          placeholder="customer@email.com"
          hint="Opens your mail app with the message written"
          onAttach={() => setShowParts((open) => !open)}
          attachLabel={showParts ? 'Hide the parts' : 'See the parts'}
          // An address that cannot receive the link is not a send.
          canSend={emailValid}
          submitLabel="Email the link"
        />

        <View style={styles.quote}>
          <View style={styles.quoteHead}>
            <View style={styles.quoteLeft}>
              <PageTitle size={22}>{`${result.lines.length} parts`}</PageTitle>
              <ThemedText style={styles.quoteMeta}>Comprehensive assessment</ThemedText>
            </View>
            <View style={styles.quoteRight}>
              <ThemedText style={styles.price}>
                {formatPrice(range.low)}
                {range.high > range.low ? `–${formatPrice(range.high)}` : ''}
              </ThemedText>
              <ThemedText style={styles.priceLabel}>Estimated range</ThemedText>
            </View>
          </View>

          <ThemedText style={styles.quoteBody}>
            The customer picks from three plans: best price, our recommendation, or all
            genuine parts.
          </ThemedText>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showParts ? 'Hide the parts' : 'See the parts'}
            onPress={() => setShowParts((open) => !open)}
            hitSlop={10}
            style={({ pressed }) => [styles.seeParts, { opacity: pressed ? 0.6 : 1 }]}
          >
            <ThemedText style={styles.seePartsText}>
              {showParts ? 'Hide the parts ←' : 'See the parts →'}
            </ThemedText>
          </Pressable>

          {showParts
            ? result.lines.map((item) => (
                <View key={item.part_id} style={styles.partRow}>
                  <ThemedText style={styles.partName} numberOfLines={1}>
                    {item.display_name}
                    {item.qty > 1 ? ` ×${item.qty}` : ''}
                  </ThemedText>
                  <ThemedText style={styles.partPrice}>
                    {item.options.length
                      ? formatPrice(Math.min(...item.options.map((o) => o.price_nzd)) * item.qty)
                      : ''}
                  </ThemedText>
                </View>
              ))
            : null}
        </View>
      </ScrollView>

      <View style={styles.actions}>
        <PrimaryButton title="Back to the assessment" onPress={() => router.back()} />
        <SecondaryButton title="Update the quote" onPress={resend} disabled={resending} />
        <ThemedText style={styles.note}>
          Re-prices against any parts you&rsquo;ve confirmed since. The link stays the same.
        </ThemedText>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Intake.page },
  padded: { padding: Intake.gutter },
  retry: { marginTop: 16 },

  main: { paddingTop: 52, paddingHorizontal: Intake.gutter, gap: 34, paddingBottom: 24 },
  titleGroup: { gap: 14, alignItems: 'center' },
  // Width-capped copy needs the block centred as well as the text.
  centredText: { textAlign: 'center', alignSelf: 'center' },
  body: { fontFamily: Faces.sans, fontSize: 14, lineHeight: 22, color: Intake.body, maxWidth: 300 },

  quote: { gap: 14, borderTopWidth: 1, borderTopColor: Intake.ruleFooter, paddingTop: 18 },
  quoteHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  quoteLeft: { flexShrink: 1, gap: 3 },
  quoteRight: { alignItems: 'flex-end', gap: 3 },
  quoteMeta: { fontFamily: Faces.sans, fontSize: 12.5, color: Intake.mutedLabel },
  price: { fontFamily: Faces.plate, fontSize: 17, color: Intake.ink },
  priceLabel: {
    fontFamily: Faces.sansMedium,
    fontSize: 9.5,
    letterSpacing: 1.33, // .14em
    textTransform: 'uppercase',
    color: Intake.mutedLabel,
  },
  quoteBody: { fontFamily: Faces.sans, fontSize: 13, lineHeight: 19.5, color: Intake.body },
  seeParts: { minHeight: 44, justifyContent: 'center', alignSelf: 'center' },
  seePartsText: { fontFamily: Faces.sansMedium, fontSize: 13, color: Intake.accent },

  partRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Intake.ruleFooter,
  },
  partName: { flex: 1, fontFamily: Faces.sans, fontSize: 13, color: Intake.ink },
  partPrice: { fontFamily: Faces.plate, fontSize: 12.5, color: Intake.body },

  actions: { paddingHorizontal: Intake.gutter, paddingBottom: 24, gap: 10 },
  note: { fontFamily: Faces.sans, fontSize: 12, lineHeight: 17.4, color: Intake.mutedLabel },
});
