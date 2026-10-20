/**
 * Test-only WCAG contrast helpers. They read the rendered tree from react-test-renderer and
 * compare each Text colour with the background it actually sits on, compositing translucent
 * backgrounds (8-digit hex or rgba()) over the layers beneath them.
 */
import { StyleSheet, Text } from 'react-native';
import type { ReactTestRenderer, ReactTestInstance } from 'react-test-renderer';

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(value: string): Rgba {
  const v = value.trim();
  if (v.startsWith('rgba(') || v.startsWith('rgb(')) {
    const [r, g, b, a = 1] = v
      .slice(v.indexOf('(') + 1, -1)
      .split(',')
      .map((part) => Number(part.trim()));
    return { r, g, b, a };
  }
  const hex = v.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  const channel = (i: number) => parseInt(full.slice(i, i + 2), 16);
  return {
    r: channel(0),
    g: channel(2),
    b: channel(4),
    a: full.length === 8 ? channel(6) / 255 : 1,
  };
}

function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a);
  const mix = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / (a || 1);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

function luminance({ r, g, b }: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio between two opaque colours (hex or rgb()). */
export function contrastRatio(foreground: string, background: string): number {
  const l1 = luminance(parseColor(foreground));
  const l2 = luminance(parseColor(background));
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Background an instance sits on: its ancestors' backgrounds composited over `base`. */
function effectiveBackground(instance: ReactTestInstance, base: string): Rgba {
  const layers: Rgba[] = [];
  let node: ReactTestInstance | null = instance.parent;
  while (node) {
    const style = StyleSheet.flatten(node.props?.style) as { backgroundColor?: unknown } | undefined;
    if (typeof style?.backgroundColor === 'string') {
      const layer = parseColor(style.backgroundColor);
      layers.push(layer);
      if (layer.a >= 1) break;
    }
    node = node.parent;
  }
  let out = parseColor(base);
  for (const layer of layers.reverse()) out = over(layer, out);
  return out;
}

export interface ContrastProblem {
  text: string;
  color: string;
  background: string;
  ratio: number;
}

/**
 * Every rendered Text with an explicit colour whose contrast against its effective background
 * is below `minimum`. An empty array means every coloured text passes.
 */
export function textContrastProblems(
  renderer: ReactTestRenderer,
  { base = '#ffffff', minimum = 4.5 }: { base?: string; minimum?: number } = {},
): ContrastProblem[] {
  const problems: ContrastProblem[] = [];
  renderer.root.findAll((n) => n.type === Text).forEach((node) => {
    const style = StyleSheet.flatten(node.props.style) as { color?: unknown } | undefined;
    if (typeof style?.color !== 'string') return;
    const bg = effectiveBackground(node, base);
    const bgHex = `#${[bg.r, bg.g, bg.b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
    const ratio = contrastRatio(style.color, bgHex);
    if (ratio < minimum) {
      const children = node.props.children;
      problems.push({
        text: typeof children === 'string' ? children : String(children),
        color: style.color,
        background: bgHex,
        ratio: Math.round(ratio * 100) / 100,
      });
    }
  });
  return problems;
}
