/**
 * The RECENT drawer: New chat, then the cases opened on this device, newest first.
 *
 * Backed by `lib/recent-cases`, not the server — the prediction backend exposes no
 * list-cases endpoint, so there is nothing to ask. See that module for what it costs.
 */

import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { SectionLabel } from '@/components/ui';
import { Radius, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { listRecentCases, subscribe, type RecentCase } from '@/lib/recent-cases';

/** `Today, 2:14 PM` · `Yesterday` · `Mon` · `12 Jul`, matching the mockup. */
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

export function RecentDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const theme = useTheme();
  const router = useRouter();
  const [cases, setCases] = useState<RecentCase[]>(listRecentCases);

  // `rememberCase` and `labelCase` both notify, so the list stays current without the
  // drawer having to re-read when it opens.
  useEffect(() => subscribe(() => setCases(listRecentCases())), []);

  const openCase = useCallback(
    (entry: RecentCase) => {
      onClose();
      router.push({
        pathname: '/case/[id]',
        params: {
          id: entry.caseId,
          vehicleId: entry.vehicleId,
          ...(entry.said ? { said: entry.said } : {}),
        },
      });
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
        <View
          style={[
            styles.panel,
            { backgroundColor: theme.background, borderRightColor: theme.border },
          ]}
        >
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

            {cases.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                No cases yet. Describe a car to start one.
              </ThemedText>
            ) : null}

            {cases.map((entry) => (
              <Pressable
                key={entry.caseId}
                accessibilityRole="button"
                onPress={() => openCase(entry)}
                style={({ pressed }) => [
                  styles.row,
                  { borderBottomColor: theme.border, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Ionicons
                  name="car-outline"
                  size={20}
                  color={theme.iconMuted}
                  style={styles.rowIcon}
                />
                <View style={styles.rowText}>
                  <ThemedText numberOfLines={1}>
                    {entry.label}
                    {entry.said ? ` — ${entry.said}` : ''}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {relativeTime(entry.openedAt)}
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
  panel: { width: '78%', maxWidth: 380, borderRightWidth: StyleSheet.hairlineWidth },
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
