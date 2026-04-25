import { canTransition, nextStatus } from './state-machine';
import { DomainError } from '../common/domain-errors';

describe('time-off request state machine', () => {
  describe('valid transitions', () => {
    it.each([
      ['PENDING_APPROVAL', 'APPROVE', 'APPROVED'],
      ['PENDING_APPROVAL', 'REJECT', 'REJECTED'],
      ['PENDING_APPROVAL', 'CANCEL', 'CANCELLED'],
      ['PENDING_APPROVAL', 'BALANCE_REVOKED', 'HCM_REJECTED'],
      ['PENDING_APPROVAL', 'HCM_REJECT', 'HCM_REJECTED'],
      ['APPROVED', 'HCM_CONFIRM', 'HCM_CONFIRMED'],
      ['APPROVED', 'HCM_REJECT', 'HCM_REJECTED'],
      ['APPROVED', 'CANCEL', 'CANCELLED'],
      ['HCM_CONFIRMED', 'CANCEL', 'CANCELLED'],
    ])('%s + %s = %s', (from, event, to) => {
      expect(nextStatus(from as never, event as never)).toBe(to);
      expect(canTransition(from as never, event as never)).toBe(true);
    });
  });

  describe('invalid transitions throw INVALID_TRANSITION', () => {
    it.each([
      ['HCM_CONFIRMED', 'APPROVE'],
      ['HCM_REJECTED', 'APPROVE'],
      ['REJECTED', 'CANCEL'],
      ['CANCELLED', 'APPROVE'],
      ['APPROVED', 'APPROVE'],
      ['PENDING_APPROVAL', 'HCM_CONFIRM'],
    ])('%s + %s throws', (from, event) => {
      expect(canTransition(from as never, event as never)).toBe(false);
      expect(() => nextStatus(from as never, event as never)).toThrow(DomainError);
    });
  });
});
