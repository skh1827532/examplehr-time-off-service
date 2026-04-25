import { HttpException, HttpStatus } from '@nestjs/common';

export type DomainErrorCode =
  | 'INSUFFICIENT_BALANCE'
  | 'UNKNOWN_LOCATION'
  | 'UNKNOWN_EMPLOYEE'
  | 'OVERLAPPING_REQUEST'
  | 'INVALID_TRANSITION'
  | 'INVALID_DATE_RANGE'
  | 'HCM_REJECTED'
  | 'HCM_UNAVAILABLE'
  | 'STALE_BALANCE'
  | 'STALE_RESOURCE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'NOT_FOUND'
  | 'BALANCE_STALE_BLOCKED';

export class DomainError extends HttpException {
  public readonly code: DomainErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: DomainErrorCode,
    message: string,
    statusCode: HttpStatus = HttpStatus.UNPROCESSABLE_ENTITY,
    details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, statusCode);
    this.code = code;
    this.details = details;
  }
}

export const DomainErrors = {
  insufficientBalance(have: number, need: number) {
    return new DomainError(
      'INSUFFICIENT_BALANCE',
      `Requested ${need} day(s), available ${have}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      { have, need },
    );
  },
  unknownLocation(locationId: string) {
    return new DomainError(
      'UNKNOWN_LOCATION',
      `Unknown location ${locationId}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      { locationId },
    );
  },
  unknownEmployee(employeeId: string) {
    return new DomainError(
      'UNKNOWN_EMPLOYEE',
      `Unknown employee ${employeeId}`,
      HttpStatus.NOT_FOUND,
      { employeeId },
    );
  },
  overlappingRequest(otherId: string) {
    return new DomainError(
      'OVERLAPPING_REQUEST',
      `Overlaps with existing request ${otherId}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      { otherId },
    );
  },
  invalidTransition(from: string, to: string) {
    return new DomainError(
      'INVALID_TRANSITION',
      `Cannot transition ${from} → ${to}`,
      HttpStatus.CONFLICT,
      { from, to },
    );
  },
  invalidDateRange(message: string) {
    return new DomainError(
      'INVALID_DATE_RANGE',
      message,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  },
  staleBalance() {
    return new DomainError(
      'STALE_BALANCE',
      'Balance was modified concurrently; please retry',
      HttpStatus.CONFLICT,
    );
  },
  balanceStaleBlocked(employeeId: string, locationId: string) {
    return new DomainError(
      'BALANCE_STALE_BLOCKED',
      `Balance for ${employeeId}/${locationId} is marked STALE; HCM has not confirmed it`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  },
  idempotencyConflict() {
    return new DomainError(
      'IDEMPOTENCY_CONFLICT',
      'Idempotency key reused with different payload',
      HttpStatus.CONFLICT,
    );
  },
  hcmUnavailable(detail?: string) {
    return new DomainError(
      'HCM_UNAVAILABLE',
      `HCM unavailable${detail ? `: ${detail}` : ''}`,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  },
  hcmRejected(detail: string) {
    return new DomainError(
      'HCM_REJECTED',
      `HCM rejected the operation: ${detail}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  },
  notFound(what: string) {
    return new DomainError('NOT_FOUND', `${what} not found`, HttpStatus.NOT_FOUND);
  },
};
