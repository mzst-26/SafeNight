/**
 * Which controls the native map dock shows. Before navigation the dock is collapsed to two
 * buttons (current location and the menu); expanding the menu shows the rest. During
 * navigation the menu does not apply and every control is shown, as before.
 */
export function nativeDockItems<T>(input: {
  collapsible: boolean;
  expanded: boolean;
  current: T | null;
  menu: T;
  hidden: T[];
  all: T[];
}): T[] {
  const { collapsible, expanded, current, menu, hidden, all } = input;
  if (!collapsible) return all;
  if (!expanded) return current == null ? [menu] : [current, menu];
  const head = current == null ? [] : [current];
  return [...head, ...hidden, menu];
}
