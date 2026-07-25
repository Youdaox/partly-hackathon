/**
 * Screen 1 — vehicle select.
 *
 * Pick a demo vehicle, create a job, and go straight into capture. Vehicles without
 * a parts catalogue are shown but disabled: the oracle needs assemblies.json.
 */

import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { VehicleSummary } from '@first-look/shared';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Card, EmptyState, ErrorNotice, Loading, Pill } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAsyncData, toErrorInfo } from '@/hooks/use-async-data';
import { useTheme } from '@/hooks/use-theme';
import { api, API_BASE_URL } from '@/lib/api';

export default function VehicleSelectScreen() {
  const router = useRouter();
  const theme = useTheme();

  const vehicles = useAsyncData(() => api.listVehicles());
  const [creatingSlug, setCreatingSlug] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ title: string; detail?: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await vehicles.reload();
    setRefreshing(false);
  }, [vehicles]);

  const startJob = useCallback(
    async (vehicle: VehicleSummary) => {
      setCreatingSlug(vehicle.slug);
      setActionError(null);
      try {
        // Seed from the shipped AI prediction so the demo starts with real damage.
        const job = await api.createJob(vehicle.slug, true);
        router.push(`/job/${job.id}/capture`);
      } catch (err) {
        setActionError(toErrorInfo(err));
      } finally {
        setCreatingSlug(null);
      }
    },
    [router],
  );

  if (vehicles.loading) {
    return (
      <ThemedView style={styles.container}>
        <Loading label="Loading vehicles…" />
      </ThemedView>
    );
  }

  const error = actionError ?? vehicles.error;

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={vehicles.data ?? []}
        keyExtractor={(item) => item.slug}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <ThemedText type="subtitle">Select a vehicle</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Starting a job seeds the visible damage list from the AI prediction, so you can
              talk through whatever else you can see.
            </ThemedText>
            {error ? <ErrorNotice title={error.title} detail={error.detail} /> : null}
          </View>
        }
        ListEmptyComponent={<EmptyState message={`No vehicles returned from ${API_BASE_URL}.`} />}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.two }} />}
        renderItem={({ item }) => {
          const disabled = !item.hasCatalogue || creatingSlug !== null;
          return (
            <Pressable
              onPress={() => startJob(item)}
              disabled={disabled}
              accessibilityRole="button"
              style={({ pressed }) => ({ opacity: disabled ? 0.45 : pressed ? 0.7 : 1 })}
            >
              <Card>
                <View style={styles.row}>
                  <View style={styles.rowText}>
                    <ThemedText type="smallBold">
                      {item.make.toUpperCase()} {item.model}
                      {item.year ? ` · ${item.year}` : ''}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {item.slug}
                    </ThemedText>
                  </View>
                  {creatingSlug === item.slug ? (
                    <ThemedText type="small" style={{ color: theme.accent }}>
                      Starting…
                    </ThemedText>
                  ) : (
                    <Pill
                      label={item.hasCatalogue ? 'Full catalogue' : 'No catalogue'}
                      tone={item.hasCatalogue ? 'accent' : 'neutral'}
                    />
                  )}
                </View>
                {!item.hasCatalogue ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Hidden damage prediction needs a parts catalogue, which this vehicle does
                    not ship with.
                  </ThemedText>
                ) : null}
              </Card>
            </Pressable>
          );
        }}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: Spacing.three, paddingBottom: Spacing.six },
  header: { gap: Spacing.two, marginBottom: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  rowText: { flex: 1, gap: Spacing.half },
});
