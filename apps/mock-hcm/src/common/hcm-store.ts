import { Injectable } from '@nestjs/common';

export interface HcmBalance {
  employeeId: string;
  locationId: string;
  balanceDays: number;
  hcmUpdatedAt: string;
}

export interface HcmTransaction {
  transactionId: string;
  idempotencyKey: string;
  employeeId: string;
  locationId: string;
  days: number;
  type: 'DEBIT' | 'CREDIT';
  reason?: string;
  recordedAt: string;
}

@Injectable()
export class HcmStore {
  private balances = new Map<string, HcmBalance>();
  private transactions = new Map<string, HcmTransaction>();
  private idempotencyIndex = new Map<string, string>();

  reset(): void {
    this.balances.clear();
    this.transactions.clear();
    this.idempotencyIndex.clear();
  }

  static key(employeeId: string, locationId: string): string {
    return `${employeeId}::${locationId}`;
  }

  upsertBalance(b: HcmBalance): HcmBalance {
    this.balances.set(HcmStore.key(b.employeeId, b.locationId), { ...b });
    return this.getBalance(b.employeeId, b.locationId)!;
  }

  getBalance(employeeId: string, locationId: string): HcmBalance | null {
    return this.balances.get(HcmStore.key(employeeId, locationId)) ?? null;
  }

  listBalances(): HcmBalance[] {
    return Array.from(this.balances.values()).map((b) => ({ ...b }));
  }

  deleteBalance(employeeId: string, locationId: string): boolean {
    return this.balances.delete(HcmStore.key(employeeId, locationId));
  }

  findTransactionByIdempotencyKey(key: string): HcmTransaction | null {
    const id = this.idempotencyIndex.get(key);
    return id ? this.transactions.get(id) ?? null : null;
  }

  recordTransaction(tx: HcmTransaction): HcmTransaction {
    this.transactions.set(tx.transactionId, tx);
    this.idempotencyIndex.set(tx.idempotencyKey, tx.transactionId);
    return tx;
  }

  listTransactions(): HcmTransaction[] {
    return Array.from(this.transactions.values()).map((t) => ({ ...t }));
  }
}
