import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError, AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import {
  HcmBalanceDto,
  HcmBatchDto,
  HcmFetchResult,
  HcmSubmitResult,
  SubmitTransactionInput,
} from './hcm.types';

export interface HcmClientConfig {
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
}

@Injectable()
export class HcmClient {
  private readonly logger = new Logger(HcmClient.name);
  private http!: AxiosInstance;
  private failures = 0;
  private circuitOpenUntil = 0;
  private readonly CIRCUIT_THRESHOLD = 5;
  private readonly CIRCUIT_COOLDOWN_MS = 10_000;

  configure(cfg: HcmClientConfig): void {
    this.http = axios.create({
      baseURL: cfg.baseUrl,
      timeout: cfg.timeoutMs,
    });
    axiosRetry(this.http, {
      retries: cfg.maxRetries,
      retryDelay: (count) => Math.min(2_000, 100 * Math.pow(2, count)),
      retryCondition: (err) => {
        if (axiosRetry.isNetworkOrIdempotentRequestError(err)) return true;
        const status = err.response?.status;
        return status === 502 || status === 503 || status === 504;
      },
    });
  }

  private ensureConfigured(): void {
    if (!this.http) {
      this.configure({
        baseUrl: process.env.HCM_BASE_URL ?? 'http://localhost:4000',
        timeoutMs: Number(process.env.HCM_REQUEST_TIMEOUT_MS ?? 5000),
        maxRetries: Number(process.env.HCM_MAX_RETRIES ?? 3),
      });
    }
  }

  private circuitOpen(): boolean {
    return Date.now() < this.circuitOpenUntil;
  }

  private noteFailure(): void {
    this.failures += 1;
    if (this.failures >= this.CIRCUIT_THRESHOLD) {
      this.circuitOpenUntil = Date.now() + this.CIRCUIT_COOLDOWN_MS;
      this.failures = 0;
      this.logger.warn(`HCM circuit OPEN for ${this.CIRCUIT_COOLDOWN_MS}ms`);
    }
  }

  private noteSuccess(): void {
    this.failures = 0;
  }

  async getBalance(
    employeeId: string,
    locationId: string,
  ): Promise<HcmFetchResult<HcmBalanceDto>> {
    this.ensureConfigured();
    if (this.circuitOpen()) {
      return { status: 'UNAVAILABLE', cause: 'circuit-open' };
    }
    try {
      const { data } = await this.http.get<HcmBalanceDto>(
        `/balances/${encodeURIComponent(employeeId)}/${encodeURIComponent(locationId)}`,
      );
      this.noteSuccess();
      return { status: 'OK', data };
    } catch (e) {
      const err = e as AxiosError;
      if (err.response?.status === 404) return { status: 'NOT_FOUND' };
      this.noteFailure();
      return { status: 'UNAVAILABLE', cause: err.message };
    }
  }

  async getBatch(): Promise<HcmFetchResult<HcmBatchDto>> {
    this.ensureConfigured();
    if (this.circuitOpen()) {
      return { status: 'UNAVAILABLE', cause: 'circuit-open' };
    }
    try {
      const { data } = await this.http.get<HcmBatchDto>('/balances/batch/full');
      this.noteSuccess();
      return { status: 'OK', data };
    } catch (e) {
      this.noteFailure();
      return { status: 'UNAVAILABLE', cause: (e as Error).message };
    }
  }

  async submitTransaction(input: SubmitTransactionInput): Promise<HcmSubmitResult> {
    this.ensureConfigured();
    if (this.circuitOpen()) {
      return { status: 'UNAVAILABLE', cause: 'circuit-open' };
    }
    try {
      const { data } = await this.http.post('/transactions', {
        employeeId: input.employeeId,
        locationId: input.locationId,
        days: input.days,
        type: input.type,
        reason: input.reason,
      }, {
        headers: { 'idempotency-key': input.idempotencyKey },
      });
      this.noteSuccess();
      return { status: 'OK', transaction: data };
    } catch (e) {
      const err = e as AxiosError<{ code?: string; message?: string }>;
      const status = err.response?.status;
      if (status && status >= 400 && status < 500) {
        // Validation/rejection — terminal, do not retry, do not break circuit.
        this.noteSuccess();
        return {
          status: 'REJECTED',
          code: err.response?.data?.code ?? 'HCM_REJECTED',
          message: err.response?.data?.message ?? `HCM ${status}`,
        };
      }
      this.noteFailure();
      return { status: 'UNAVAILABLE', cause: err.message };
    }
  }

  /** Test-only: reset circuit. */
  resetCircuit(): void {
    this.failures = 0;
    this.circuitOpenUntil = 0;
  }
}
