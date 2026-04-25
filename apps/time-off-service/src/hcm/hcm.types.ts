export interface HcmBalanceDto {
  employeeId: string;
  locationId: string;
  balanceDays: number;
  hcmUpdatedAt: string;
}

export interface HcmBatchDto {
  generatedAt: string;
  balances: HcmBalanceDto[];
}

export interface HcmTransactionDto {
  transactionId: string;
  idempotencyKey: string;
  employeeId: string;
  locationId: string;
  days: number;
  type: 'DEBIT' | 'CREDIT';
  recordedAt: string;
  reason?: string;
}

export interface SubmitTransactionInput {
  idempotencyKey: string;
  employeeId: string;
  locationId: string;
  days: number;
  type: 'DEBIT' | 'CREDIT';
  reason?: string;
}

export type HcmSubmitResult =
  | { status: 'OK'; transaction: HcmTransactionDto }
  | { status: 'REJECTED'; code: string; message: string }
  | { status: 'UNAVAILABLE'; cause: string };

export type HcmFetchResult<T> =
  | { status: 'OK'; data: T }
  | { status: 'NOT_FOUND' }
  | { status: 'UNAVAILABLE'; cause: string };
