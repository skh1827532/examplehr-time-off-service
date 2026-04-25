import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { Observable, from, of, switchMap, tap } from 'rxjs';
import { Request, Response } from 'express';
import { IdempotencyKey } from './idempotency-key.entity';
import { DomainErrors } from './domain-errors';

const HEADER = 'idempotency-key';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @InjectRepository(IdempotencyKey)
    private readonly repo: Repository<IdempotencyKey>,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const rawKey = (req.headers[HEADER] ?? req.headers[HEADER.toUpperCase()]) as
      | string
      | undefined;

    if (!rawKey) {
      // Header is optional — fall through.
      return next.handle();
    }

    const scope = `${req.method} ${req.route?.path ?? req.path}`;
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(req.body ?? {}))
      .digest('hex');
    const fullKey = `${scope}::${rawKey}`;

    return from(this.repo.findOne({ where: { key: fullKey } })).pipe(
      switchMap((existing) => {
        if (existing) {
          if (existing.payloadHash !== payloadHash) {
            throw DomainErrors.idempotencyConflict();
          }
          res.status(existing.statusCode);
          return of(existing.response);
        }
        return next.handle().pipe(
          tap(async (body) => {
            try {
              await this.repo.insert({
                key: fullKey,
                scope,
                payloadHash,
                response: (body ?? {}) as Record<string, unknown>,
                statusCode: res.statusCode,
              });
            } catch {
              // ignore unique conflicts (concurrent first calls)
            }
          }),
        );
      }),
    );
  }
}
