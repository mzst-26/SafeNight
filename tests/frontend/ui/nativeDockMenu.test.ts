import { nativeDockItems } from '@/src/components/ui/nativeDockMenu';

const ALL = ['profile', 'safety', 'live', 'report', 'current'];

describe('nativeDockItems', () => {
  it('shows only current location and the menu button before navigation when collapsed', () => {
    expect(
      nativeDockItems({ collapsible: true, expanded: false, current: 'current', menu: 'menu', hidden: ['profile', 'safety', 'live', 'report'], all: ALL }),
    ).toEqual(['current', 'menu']);
  });

  it('shows current location, the hidden buttons, then the menu button when expanded', () => {
    expect(
      nativeDockItems({ collapsible: true, expanded: true, current: 'current', menu: 'menu', hidden: ['profile', 'safety', 'live', 'report'], all: ALL }),
    ).toEqual(['current', 'profile', 'safety', 'live', 'report', 'menu']);
  });

  it('keeps every button during navigation, where the menu does not apply', () => {
    expect(
      nativeDockItems({ collapsible: false, expanded: false, current: 'current', menu: 'menu', hidden: ['profile', 'safety', 'live', 'report'], all: ALL }),
    ).toEqual(ALL);
  });

  it('leaves out a missing current location control instead of showing an empty slot', () => {
    expect(
      nativeDockItems<string>({ collapsible: true, expanded: false, current: null, menu: 'menu', hidden: [], all: [] }),
    ).toEqual(['menu']);
  });
});
