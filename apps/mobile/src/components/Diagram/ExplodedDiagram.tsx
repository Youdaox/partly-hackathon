/**
 * 2D OEM-style exploded diagram, shown after a part is selected in the 3D viewer.
 *
 * No real diagram asset is wired in yet (see `diagramImage`, left as an escape hatch
 * for when the team wires this to a real `data/vehicles/*\/diagrams/*\/image.webp`) —
 * until then it draws a numbered-parts schematic with react-native-svg so the
 * interaction (zoom, pan, numbered components) is fully demoable.
 *
 * Zoom/pan is Reanimated + Gesture Handler, worklet-driven so pinch stays smooth on
 * the UI thread instead of round-tripping through React state on every frame.
 *
 * "use no memo": the pinch/pan worklets and the reset-on-open effect mutate the same
 * shared values from multiple places by design (gesture, reset button, open effect) —
 * exactly the pattern React Compiler's purity rules flag, and exactly how Reanimated
 * shared values are meant to be used.
 */
'use no memo';
/* eslint-disable react-hooks/immutability --
   same reason as the "use no memo" pragma above. */

import { useEffect } from 'react';
import { Image, Modal, Pressable, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, G, Line, Rect, Text as SvgText } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const DIAGRAM_SIZE = 320;

interface ExplodedDiagramProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  parts: string[];
  selectedPart?: string;
  diagramImage?: ImageSourcePropType;
}

export function ExplodedDiagram({
  visible,
  onClose,
  title,
  parts,
  selectedPart,
  diagramImage,
}: ExplodedDiagramProps) {
  const theme = useTheme();

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, [visible, scale, savedScale, translateX, translateY, savedTranslateX, savedTranslateY]);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = Math.min(Math.max(savedScale.value * event.scale, 1), 4);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      translateX.value = savedTranslateX.value + event.translationX;
      translateY.value = savedTranslateY.value + event.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const composedGesture = Gesture.Simultaneous(pinchGesture, panGesture);

  const contentStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const resetZoom = () => {
    scale.value = withTiming(1);
    savedScale.value = 1;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.header}>
          <ThemedText type="smallBold">{title}</ThemedText>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              Close
            </ThemedText>
          </Pressable>
        </View>

        <View style={styles.viewport}>
          <GestureDetector gesture={composedGesture}>
            <Animated.View style={contentStyle}>
              {diagramImage ? (
                <Image
                  source={diagramImage}
                  style={{ width: DIAGRAM_SIZE, height: DIAGRAM_SIZE }}
                  resizeMode="contain"
                />
              ) : (
                <GeneratedDiagram parts={parts} selectedPart={selectedPart} />
              )}
            </Animated.View>
          </GestureDetector>
        </View>

        <Pressable onPress={resetZoom} style={styles.resetButton} accessibilityRole="button">
          <ThemedText type="small" themeColor="textSecondary">
            Reset zoom
          </ThemedText>
        </Pressable>
      </View>
    </Modal>
  );
}

/** Numbered-parts placeholder schematic — swap for a real OEM diagram image when available. */
function GeneratedDiagram({ parts, selectedPart }: { parts: string[]; selectedPart?: string }) {
  const theme = useTheme();
  const center = DIAGRAM_SIZE / 2;
  const radius = DIAGRAM_SIZE * 0.38;

  return (
    <Svg width={DIAGRAM_SIZE} height={DIAGRAM_SIZE}>
      <Rect
        x={center - 50}
        y={center - 35}
        width={100}
        height={70}
        rx={10}
        fill={theme.backgroundElement}
        stroke={theme.border}
      />
      {parts.map((part, index) => {
        const angle = (index / Math.max(parts.length, 1)) * Math.PI * 2;
        const x = center + radius * Math.cos(angle);
        const y = center + radius * Math.sin(angle);
        const isSelected = part === selectedPart;

        return (
          <G key={part}>
            <Line
              x1={center}
              y1={center}
              x2={x}
              y2={y}
              stroke={theme.border}
              strokeWidth={1}
            />
            <Circle
              cx={x}
              cy={y}
              r={14}
              fill={isSelected ? theme.accent : theme.backgroundSelected}
              stroke={theme.border}
            />
            <SvgText
              x={x}
              y={y + 4}
              fontSize={11}
              fontWeight="700"
              textAnchor="middle"
              fill={isSelected ? theme.accentText : theme.text}
            >
              {index + 1}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.three,
    paddingTop: Spacing.six,
  },
  viewport: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  resetButton: { alignItems: 'center', paddingVertical: Spacing.three },
});
