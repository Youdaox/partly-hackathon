/**
 * The AFFECTED ZONES card: a side-profile silhouette with a numbered marker for each
 * predicted part, positioned by `lib/zones.ts`.
 *
 * Everything including the badges is drawn inside the SVG, so marker positions live in
 * one coordinate space and cannot drift from the artwork when the card resizes.
 */

import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Zone } from '@/lib/zones';

const VIEW_W = 400;
const VIEW_H = 180;

/** Zone coordinates are normalised 0..1; these place them in the viewBox. */
const toX = (x: number) => 24 + x * 358;
const toY = (y: number) => 9.4 + y * 161;

/** Side profile, facing left. One closed body outline plus two wheels. */
const BODY =
  'M24 132 L24 104 C24 98 30 94 44 92 L118 86 L158 50 C162 46 168 44 176 44 ' +
  'L250 44 C262 44 272 48 280 56 L320 90 L368 96 C378 98 382 104 382 112 L382 132 Z';
/** Belt line, so the greenhouse reads as glass rather than solid body. */
const BELT = 'M124 86 L318 90';

export interface ZoneMarker {
  /** The number shown on the badge, matching the report row. */
  n: number;
  zone: Zone;
}

/**
 * Impact-zone variant, driven by the backend's `impact.zone`.
 *
 * Every part in the check section is in the impact zone by construction, so the markers
 * fan out from that one point rather than each being placed independently.
 */
export function ImpactZones({
  point,
  count,
  radius = 40,
}: {
  point: { x: number; y: number } | null;
  /** How many numbered markers to fan out. */
  count: number;
  radius?: number;
}) {
  const theme = useTheme();

  const cx = point ? toX(point.x) : 0;
  const cy = point ? toY(point.y) : 0;
  const shown = Math.min(count, 5);

  return (
    <View style={styles.container}>
      <Svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} style={styles.svg}>
        <Path d={BODY} fill="none" stroke={theme.textSecondary} strokeWidth={2} strokeLinejoin="round" />
        <Path d={BELT} fill="none" stroke={theme.textSecondary} strokeWidth={1.5} />
        <Circle cx={120} cy={132} r={27} fill="none" stroke={theme.textSecondary} strokeWidth={2} />
        <Circle cx={292} cy={132} r={27} fill="none" stroke={theme.textSecondary} strokeWidth={2} />

        {point ? (
          <>
            <Circle cx={cx} cy={cy} r={radius} fill={theme.accent} opacity={0.16} />
            {Array.from({ length: shown }, (_, i) => {
              // Fan across the highlight so the badges do not sit on top of each other.
              const spread = (i - (shown - 1) / 2) * 26;
              return (
                <G key={`impact-${i}`}>
                  <Circle cx={cx + spread * 0.55} cy={cy + spread * 0.5} r={11.5} fill={theme.badgeText} />
                  <SvgText
                    x={cx + spread * 0.55}
                    y={cy + spread * 0.5 + 4.5}
                    fill={theme.accentText}
                    fontSize={13}
                    fontWeight="bold"
                    textAnchor="middle"
                  >
                    {i + 1}
                  </SvgText>
                </G>
              );
            })}
          </>
        ) : null}
      </Svg>

      {point ? null : (
        <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
          No impact zone determined yet.
        </ThemedText>
      )}
    </View>
  );
}

export function VehicleZones({ markers }: { markers: ZoneMarker[] }) {
  const theme = useTheme();

  // Markers sharing a zone fan out vertically rather than stacking on top of each other.
  const byZone = new Map<string, ZoneMarker[]>();
  for (const marker of markers) {
    const list = byZone.get(marker.zone.id) ?? [];
    list.push(marker);
    byZone.set(marker.zone.id, list);
  }

  return (
    <View style={styles.container}>
      <Svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} style={styles.svg}>
        <Path d={BODY} fill="none" stroke={theme.textSecondary} strokeWidth={2} strokeLinejoin="round" />
        <Path d={BELT} fill="none" stroke={theme.textSecondary} strokeWidth={1.5} />
        <Circle cx={120} cy={132} r={27} fill="none" stroke={theme.textSecondary} strokeWidth={2} />
        <Circle cx={292} cy={132} r={27} fill="none" stroke={theme.textSecondary} strokeWidth={2} />

        {/* A soft halo per affected zone, drawn under the badges. */}
        {[...byZone.values()].map((group) => (
          <Circle
            key={`halo-${group[0].zone.id}`}
            cx={toX(group[0].zone.x)}
            cy={toY(group[0].zone.y)}
            r={34}
            fill={theme.accent}
            opacity={0.14}
          />
        ))}

        {[...byZone.values()].flatMap((group) =>
          group.map((marker, i) => {
            const cx = toX(marker.zone.x);
            const cy = toY(marker.zone.y) + (i - (group.length - 1) / 2) * 25;
            return (
              <G key={`marker-${marker.n}`}>
                <Circle cx={cx} cy={cy} r={11.5} fill={theme.badgeText} />
                <SvgText
                  x={cx}
                  y={cy + 4.5}
                  fill={theme.accentText}
                  fontSize={13}
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  {marker.n}
                </SvgText>
              </G>
            );
          }),
        )}
      </Svg>

      {markers.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
          Nothing placed on the vehicle yet.
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  svg: { width: '100%', aspectRatio: VIEW_W / VIEW_H },
  empty: { textAlign: 'center' },
});
