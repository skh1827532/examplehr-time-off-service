import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type OutboxStatus = 'PENDING' | 'IN_FLIGHT' | 'SENT' | 'FAILED' | 'FAILED_PERMANENT';

export type OutboxEventType =
  | 'HCM_SUBMIT_DEBIT'   // approved request → DEBIT to HCM
  | 'HCM_SUBMIT_CREDIT'; // cancelled approved request → CREDIT (refund) to HCM

@Entity('outbox_events')
@Index('idx_outbox_status_next', ['status', 'nextAttemptAt'])
export class OutboxEvent {
  @PrimaryColumn({ type: 'varchar' })
  id!: string;

  @Column({ type: 'varchar' })
  aggregateType!: string;

  @Column({ type: 'varchar' })
  aggregateId!: string;

  @Column({ type: 'varchar' })
  eventType!: OutboxEventType;

  @Column({ type: 'varchar' })
  idempotencyKey!: string;

  @Column({ type: 'simple-json' })
  payload!: Record<string, unknown>;

  @Column({ type: 'varchar', default: 'PENDING' })
  status!: OutboxStatus;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ type: 'datetime', nullable: true })
  nextAttemptAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
