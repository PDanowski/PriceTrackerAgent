import { describe, it, expect } from 'vitest';
import { getSecondsUntilNextNoonCET } from '../src/utils/timeUtils';

describe('Time Utilities', () => {
  it('calculates positive seconds until next noon CET', () => {
    const seconds = getSecondsUntilNextNoonCET();
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(86400);
  });
});
