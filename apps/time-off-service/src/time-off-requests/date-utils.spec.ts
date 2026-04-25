import { inclusiveDayCount, isValidRange, rangesOverlap } from './date-utils';

describe('date-utils', () => {
  describe('isValidRange', () => {
    it('accepts equal dates', () => {
      expect(isValidRange('2026-04-25', '2026-04-25')).toBe(true);
    });
    it('accepts ascending dates', () => {
      expect(isValidRange('2026-04-25', '2026-04-26')).toBe(true);
    });
    it('rejects descending dates', () => {
      expect(isValidRange('2026-04-26', '2026-04-25')).toBe(false);
    });
  });

  describe('rangesOverlap', () => {
    it('detects overlap when fully contained', () => {
      expect(rangesOverlap('2026-04-01', '2026-04-30', '2026-04-10', '2026-04-15')).toBe(true);
    });
    it('detects overlap on boundary day', () => {
      expect(rangesOverlap('2026-04-01', '2026-04-10', '2026-04-10', '2026-04-15')).toBe(true);
    });
    it('returns false for disjoint ranges', () => {
      expect(rangesOverlap('2026-04-01', '2026-04-09', '2026-04-10', '2026-04-15')).toBe(false);
    });
  });

  describe('inclusiveDayCount', () => {
    it('counts a single day as 1', () => {
      expect(inclusiveDayCount('2026-04-25', '2026-04-25')).toBe(1);
    });
    it('counts a 5-day range as 5', () => {
      expect(inclusiveDayCount('2026-04-25', '2026-04-29')).toBe(5);
    });
    it('returns 0 for invalid ranges', () => {
      expect(inclusiveDayCount('2026-04-29', '2026-04-25')).toBe(0);
    });
  });
});
