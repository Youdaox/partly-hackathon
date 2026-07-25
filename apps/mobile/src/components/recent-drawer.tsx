/**
 * The RECENT drawer: New chat, then every job the API knows about, most recent first.
 *
 * Slides over the entry screen from the left and dims what is behind it. Loads its list
 * each time it opens so a job started on this device is there without a manual refresh.
 */

import { useCallback, useEffect } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Job, JobStatus, VehicleSummary } from '@partli/shared';

import { ThemedText } from '@/components/themed-text';
import { ErrorNotice, Loading, SectionLabel } from '@/components/ui';
import { Radius, Spacing, TapTarget } from '@/constants/theme';
import { useAsyncData } from '@/hooks/use-async-data';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';

/** What the job has got to, in the repairer's words rather than the schema's. */
const STATUS_LABEL: Record<JobStatus, string> = {
  capturing: 'in progress',
  predicted: 'hidden damage ranked',
  sent_to_customer: 'sent to customer',
  approved: 'approved',
};

/**
 * `Today, 2:14 PM` · `Yesterday` · `Mon` · `12 Jul`, matching the mockup.
 */
function relativeTime(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(then)) / 86_400_000);

  if (days <= 0) {
    return `Today, ${then.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
  if (days === 1) return 'Yesterday';
  if (days < 7) return then.toLocaleDateString(undefined, { weekday: 'short' });
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function vehicleName(vehicle: VehicleSummary | null | undefined, fallback: string): string {
  if (!vehicle) return fallback;
  return [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
}

export function RecentDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const theme = useTheme();
  const router = useRouter();
  const jobs = useAsyncData(() => api.listJobs(), []);

  useEffect(() => {
    if (open) void jobs.reload();
    // Reloading is keyed on `open` alone; `jobs` is a new object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const openJob = useCallback(
    (job: Job) => {
      onClose();
      router.push({ pathname: '/job/[id]/hidden', params: { id: job.id } });
    },
    [onClose, router],
  );

  const newChat = useCallback(() => {
    onClose();
    router.push('/');
  }, [onClose, router]);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.panel, { backgroundColor: theme.background, borderRightColor: theme.border }]}>
          <ScrollView contentContainerStyle={styles.panelContent}>
            <Pressable
              accessibilityRole="button"
              onPress={newChat}
              style={({ pressed }) => [
                styles.newChat,
                { borderColor: theme.border, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Ionicons name="add" size={20} color={theme.text} />
              <ThemedText type="rowTitle">New chat</ThemedText>
            </Pressable>

            <View style={styles.section}>
              <SectionLabel>RECENT</SectionLabel>
            </View>

            {jobs.loading ? <Loading /> : null}
            {jobs.error ? <ErrorNotice title={jobs.error.title} detail={jobs.error.detail} /> : null}

            {jobs.data?.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                No jobs yet. Describe a car to start one.
              </ThemedText>
            ) : null}

            {(jobs.data ?? []).map((job) => (
              <Pressable
                key={job.id}
                accessibilityRole="button"
                onPress={() => openJob(job)}
                style={({ pressed }) => [
                  styles.row,
                  { borderBottomColor: theme.border, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Ionicons name="car-outline" size={20} color={theme.iconMuted} style={styles.rowIcon} />
                <View style={styles.rowText}>
                  <ThemedText numberOfLines={1}>
                    {vehicleName(job.vehicle, job.vehicleSlug)} — {STATUS_LABEL[job.status]}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {relativeTime(job.createdAt)}
                  </ThemedText>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* Tapping the dimmed remainder of the screen closes the drawer. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close menu"
          onPress={onClose}
          style={styles.backdrop}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, flexDirection: 'row' },
  panel: {
    width: '78%',
    maxWidth: 380,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  panelContent: {
    paddingTop: Spacing.six,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
  },
  newChat: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: TapTarget,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.prompt,
  },
  section: { paddingTop: Spacing.three, paddingBottom: Spacing.one },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: TapTarget + 12,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: { marginTop: 2 },
  rowText: { flex: 1, gap: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(20,22,24,0.45)' },
});
