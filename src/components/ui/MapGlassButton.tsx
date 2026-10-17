/**
 * MapGlassButton — round frosted-glass control for the map's side dock.
 *
 * Two states:
 *   – idle:   neutral glass, dark icon
 *   – active: glass tinted with `activeColor`, coloured icon and border
 * Toggle buttons pass `toggle` so screen readers announce them as switches.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

type IconName = ComponentProps<typeof Ionicons>['name'];

export const MAP_GLASS_BUTTON_SIZE = 48;

export interface MapGlassButtonProps {
  icon: IconName;
  label: string;
  onPress?: () => void;
  /** Two-state buttons: true shows the active (tinted) appearance. */
  active?: boolean;
  /** Announce as a switch with checked state (for on/off buttons). */
  toggle?: boolean;
  /** Icon colour in the idle state. */
  iconColor?: string;
  /** Tint used for the active state, as #RRGGBB. */
  activeColor?: string;
  disabled?: boolean;
  /** Extra overlay such as a status dot; positioned by the caller. */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Converts #RRGGBB and an alpha into an rgba() string. */
function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function MapGlassButton({
  icon,
  label,
  onPress,
  active = false,
  toggle = false,
  iconColor = '#344054',
  activeColor = '#1570ef',
  disabled = false,
  children,
  style,
}: MapGlassButtonProps) {
  const activeIconColor = activeColor;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={toggle ? 'switch' : 'button'}
      accessibilityState={toggle ? { checked: active, disabled } : { disabled }}
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [
        styles.base,
        active
          ? {
              backgroundColor: withAlpha(activeColor, 0.26),
              borderColor: withAlpha(activeColor, 0.55),
              boxShadow: `0 6px 18px ${withAlpha(activeColor, 0.32)}, inset 0 1px 0 rgba(255, 255, 255, 0.8)`,
            }
          : null,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Ionicons name={icon} size={21} color={active ? activeIconColor : iconColor} />
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: MAP_GLASS_BUTTON_SIZE,
    height: MAP_GLASS_BUTTON_SIZE,
    borderRadius: MAP_GLASS_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // See-through glass: the map shows through, with a light rim and a top highlight.
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    boxShadow: '0 6px 18px rgba(15, 23, 42, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.7)',
    backdropFilter: 'blur(20px) saturate(180%)',
    cursor: 'pointer',
  } as any,
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  disabled: {
    opacity: 0.5,
  },
});
