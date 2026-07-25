/**
 * Screen 1: which vehicle?
 *
 * The same hero the app has always had — centred greeting, the composer pill
 * under it, suggestion rows below — asking one thing instead of anything. It
 * used to say "What's going on with the car?" over a free-text box that took a
 * sentence and guessed a plate out of it; now it asks for the plate, and the
 * suggestions are the vehicles you can actually start.
 *
 * Keeping the composer rather than swapping in a form field is deliberate: the
 * app is a conversation with an assistant, and the first turn being a text box
 * with a "Look up vehicle" button underneath makes it a database lookup
 * instead.
 *
 * Send hands straight over to screen 2. It does *not* wait for the VIN:
 * `registerVehicle` returns immediately with status `resolving`, and resolving
 * a real catalogue takes long enough that a loading screen in front of it
 * would be dead time the repairer could have spent photographing the car. The
 * lookup runs behind screen 2 and reports itself on a status line there.
 */

import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Composer } from '@/components/composer';
import { ThemedText } from '@/components/themed-text';
import { SuggestionRow } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { toErrorInfo, useAsyncData } from '@/hooks/use-async-data';
import type { ErrorInfo } from '@/hooks/use-case';
import { useTheme } from '@/hooks/use-theme';
import { backend } from '@/lib/backend';

export interface RegoEntryProps {
  /** Fired as soon as the plate is accepted — before the VIN comes back. */
  onRegistered: (vehicleId: string, rego: string) => void;
}

export function RegoEntry({ onRegistered }: RegoEntryProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);

  // The vehicles that ship a full OEM catalogue, for the quick-pick rows.
  const vehicles = useAsyncData(async () => (await backend.listVehicles()).vehicles);
  const startable = (vehicles.data ?? []).filter((v) => v.has_catalogue);

  const lookUp = useCallback(
    async (plate: string) => {
      // Whatever is in the box is the rego. Punctuation and spaces are typing,
      // not part of a plate.
      const trimmed = plate.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      if (!trimmed || submitting) return;

      setError(null);
      setSubmitting(true);
      try {
        // Returns at once with status `resolving`. Everything after this point
        // happens behind screen 2.
        const registered = await backend.registerVehicle(trimmed);
        onRegistered(registered.vehicle_id, trimmed);
      } catch (caught) {
        setError(toErrorInfo(caught));
      } finally {
        setSubmitting(false);
      }
    },
    [onRegistered, submitting],
  );

  // --- the hero -------------------------------------------------------------
  return (
    <ScrollView contentContainerStyle={styles.heroScroll} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <ThemedText type="heading" style={styles.heading}>
          Enter the rego to start.
        </ThemedText>

        <Composer
          value={draft}
          onChangeText={setDraft}
          onSubmit={() => void lookUp(draft)}
          placeholder="Enter the rego number (e.g. QMN16)"
          busy={submitting}
        />

        {error ? (
          <View style={styles.error}>
            <ThemedText type="small" style={{ color: theme.danger }}>
              {error.title}
            </ThemedText>
            {error.detail ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.errorDetail}>
                {error.detail}
              </ThemedText>
            ) : null}
          </View>
        ) : null}

        {/* Quick-picks, so the demo does not depend on remembering a plate. */}
        <View style={styles.suggestions}>
          {startable.map((vehicle) => (
            <SuggestionRow
              key={vehicle.rego}
              icon="car-sport-outline"
              label={`${vehicle.rego} · ${vehicle.make} ${vehicle.model}`}
              onPress={() => {
                setDraft(vehicle.rego);
                void lookUp(vehicle.rego);
              }}
            />
          ))}
          <SuggestionRow
            icon="list-outline"
            label="Which vehicles can I assess?"
            onPress={() =>
              setError({
                title: startable.length
                  ? 'Vehicles with a parts catalogue'
                  : 'No catalogue vehicles found',
                detail: startable.length
                  ? `${startable
                      .map((v) => `${v.make} ${v.model} (${v.rego})`)
                      .join(', ')}. Type one of those regos.`
                  : 'Is the backend running on port 8080?',
              })
            }
          />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Matches the hero the app already used, so screen 1 reads as the same app.
  heroScroll: { flexGrow: 1, justifyContent: 'center', padding: Spacing.three },
  hero: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  heading: { textAlign: 'center', marginBottom: Spacing.four },
  suggestions: { marginTop: Spacing.four },

  error: { marginTop: Spacing.three, alignItems: 'center', gap: Spacing.half },
  errorDetail: { textAlign: 'center' },
});
