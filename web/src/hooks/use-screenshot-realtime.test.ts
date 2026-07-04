import { describe, it, expect } from 'vitest';
import { shouldRefetchForScreenshot } from '@/hooks/use-screenshot-realtime';

describe('shouldRefetchForScreenshot — role scoping', () => {
  const ownEvent = { user_id: 'user-1' };
  const otherEvent = { user_id: 'user-2' };

  it('ignores events when there is no viewer (unauthenticated)', () => {
    expect(shouldRefetchForScreenshot(ownEvent, null)).toBe(false);
    expect(shouldRefetchForScreenshot(ownEvent, undefined)).toBe(false);
  });

  it('lets an employee refetch for their OWN screenshot', () => {
    expect(
      shouldRefetchForScreenshot(ownEvent, { id: 'user-1', role: 'employee' }),
    ).toBe(true);
  });

  it("ignores another user's screenshot for an employee", () => {
    expect(
      shouldRefetchForScreenshot(otherEvent, { id: 'user-1', role: 'employee' }),
    ).toBe(false);
  });

  it('coerces a numeric user_id when matching an employee (no false negative)', () => {
    expect(
      shouldRefetchForScreenshot({ user_id: 42 }, { id: '42', role: 'employee' }),
    ).toBe(true);
    expect(
      shouldRefetchForScreenshot({ user_id: 99 }, { id: '42', role: 'employee' }),
    ).toBe(false);
  });

  it.each(['owner', 'admin', 'manager'])(
    'lets a %s refetch for the whole team (org-wide)',
    (role) => {
      expect(shouldRefetchForScreenshot(otherEvent, { id: 'user-1', role })).toBe(true);
      expect(shouldRefetchForScreenshot(ownEvent, { id: 'user-1', role })).toBe(true);
    },
  );
});
