import { TimeOffRequestStatus } from './time-off-request.entity';
import { DomainErrors } from '../common/domain-errors';

export type TimeOffEvent =
  | 'APPROVE'           // PENDING_APPROVAL → APPROVED
  | 'REJECT'            // PENDING_APPROVAL → REJECTED
  | 'CANCEL'            // PENDING_APPROVAL or APPROVED or HCM_CONFIRMED → CANCELLED
  | 'HCM_CONFIRM'       // APPROVED → HCM_CONFIRMED
  | 'HCM_REJECT'        // APPROVED → HCM_REJECTED, or PENDING_APPROVAL → HCM_REJECTED (balance revoked)
  | 'BALANCE_REVOKED';  // PENDING_APPROVAL → HCM_REJECTED (no HCM call yet)

const TABLE: Record<TimeOffRequestStatus, Partial<Record<TimeOffEvent, TimeOffRequestStatus>>> = {
  PENDING_APPROVAL: {
    APPROVE: 'APPROVED',
    REJECT: 'REJECTED',
    CANCEL: 'CANCELLED',
    BALANCE_REVOKED: 'HCM_REJECTED',
    HCM_REJECT: 'HCM_REJECTED',
  },
  APPROVED: {
    HCM_CONFIRM: 'HCM_CONFIRMED',
    HCM_REJECT: 'HCM_REJECTED',
    CANCEL: 'CANCELLED',
  },
  HCM_CONFIRMED: {
    CANCEL: 'CANCELLED',
  },
  HCM_REJECTED: {},
  REJECTED: {},
  CANCELLED: {},
};

export function nextStatus(
  current: TimeOffRequestStatus,
  event: TimeOffEvent,
): TimeOffRequestStatus {
  const next = TABLE[current][event];
  if (!next) throw DomainErrors.invalidTransition(current, event);
  return next;
}

export function canTransition(
  current: TimeOffRequestStatus,
  event: TimeOffEvent,
): boolean {
  return !!TABLE[current][event];
}
