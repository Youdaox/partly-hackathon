/**
 * Damage travelling through a parts graph, as a loop.
 *
 * Shown while the prediction runs, in place of a checklist. The engine's whole
 * claim is that damage you can see implies damage you cannot — it walks edges
 * from the observed parts to the ones behind them — and a list of stage labels
 * describes that where a moving graph shows it. Four nodes, three edges,
 * lighting up bottom-left to top-right: origin, then along the load path.
 *
 * Driven by `requestAnimationFrame` rather than Reanimated, deliberately.
 * Reanimated's `useAnimatedStyle` is proven on web here (the composer grows
 * with it), but this needs animated *SVG props* — `strokeDashoffset` on a
 * path, `r` and `opacity` on a circle — and `useAnimatedProps` against
 * react-native-svg through react-native-web is the part that silently renders
 * a static frame when it does not work. A static frame is the one outcome this
 * component must never have, and rAF behaves identically on both platforms.
 * The cost is one small re-render per frame of eight SVG children, which is
 * nothing.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';

/** One full sweep, including the hold at the end. */
const PERIOD_MS = 2000;

const VIEW = { width: 120, height: 100 };

/** Bottom-left to top-right, with a dip at the third — a rising trend line. */
const NODES = [
  { x: 16, y: 82 },
  { x: 48, y: 42 },
  { x: 78, y: 60 },
  { x: 106, y: 18 },
] as const;

/**
 * When each element fills, as a fraction of the cycle. Nodes are quick, edges
 * take the time — the travel between parts is the thing being shown.
 */
const TIMING = {
  nodes: [
    [0.0, 0.1],
    [0.32, 0.4],
    [0.6, 0.68],
    [0.9, 0.97],
  ],
  edges: [
    [0.1, 0.32],
    [0.4, 0.6],
    [0.68, 0.9],
  ],
} as const;

const NODE_R = 8;
const EDGE_W = 5;

/** 0 before `from`, 1 after `to`, smoothly eased between. */
function span(t: number, from: number, to: number): number {
  const raw = Math.min(1, Math.max(0, (t - from) / (to - from)));
  // Smoothstep: the fill accelerates in and settles rather than snapping.
  return raw * raw * (3 - 2 * raw);
}

export function PropagationGraph({ size = 140 }: { size?: number }) {
  const theme = useTheme();
  const [t, setT] = useState(0);

  useEffect(() => {
    let frame = 0;
    let start: number | null = null;

    const tick = (now: number) => {
      if (start === null) start = now;
      setT(((now - start) % PERIOD_MS) / PERIOD_MS);
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const height = (size * VIEW.height) / VIEW.width;

  return (
    <View style={[styles.wrap, { width: size, height }]}>
      <Svg width={size} height={height} viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}>
        {/* The graph at rest. The red pass is drawn over the top of it. */}
        {NODES.slice(0, -1).map((from, i) => {
          const to = NODES[i + 1];
          return (
            <Line
              key={`rest-${i}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={theme.border}
              strokeWidth={EDGE_W}
              strokeLinecap="round"
            />
          );
        })}

        {/* Damage travelling along each edge, revealed by retracting the dash. */}
        {NODES.slice(0, -1).map((from, i) => {
          const to = NODES[i + 1];
          const length = Math.hypot(to.x - from.x, to.y - from.y);
          const fill = span(t, TIMING.edges[i][0], TIMING.edges[i][1]);
          if (fill <= 0) return null;
          return (
            <Line
              key={`flow-${i}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={theme.danger}
              strokeWidth={EDGE_W}
              strokeLinecap="round"
              strokeDasharray={length}
              strokeDashoffset={length * (1 - fill)}
            />
          );
        })}

        {NODES.map((node, i) => (
          <Circle
            key={`rest-node-${i}`}
            cx={node.x}
            cy={node.y}
            r={NODE_R}
            fill={theme.backgroundElement}
            stroke={theme.border}
            strokeWidth={2}
          />
        ))}

        {NODES.map((node, i) => {
          const fill = span(t, TIMING.nodes[i][0], TIMING.nodes[i][1]);
          if (fill <= 0) return null;
          // A brief swell as each one takes the damage, then it settles.
          const swell = Math.sin(fill * Math.PI) * 1.6;
          return (
            <Circle
              key={`hit-${i}`}
              cx={node.x}
              cy={node.y}
              r={NODE_R + swell}
              fill={theme.danger}
              opacity={fill}
            />
          );
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'center' },
});
