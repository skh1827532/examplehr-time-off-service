import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

export type TimeOffRequestStatus =
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'HCM_CONFIRMED'
  | 'HCM_REJECTED'
  | 'REJECTED'
  | 'CANCELLED';

export const TERMINAL_STATUSES: ReadonlySet<TimeOffRequestStatus> = new Set([
  'HCM_CONFIRMED',
  'HCM_REJECTED',
  'REJECTED',
  'CANCELLED',
]);

@Entity('time_off_requests')
@Index('idx_employee_status', ['employeeId', 'status'])
@Index('idx_location_status', ['locationId', 'status'])
export class TimeOffRequest {
  @PrimaryColumn({ type: 'varchar' })
  id!: string;

  @Column({ type: 'varchar' })
  employeeId!: string;

  @Column({ type: 'varchar' })
  locationId!: string;

  @Column({ type: 'date' })
  startDate!: string;

  @Column({ type: 'date' })
  endDate!: string;

  @Column({ type: 'real' })
  days!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason!: string | null;

  @Column({ type: 'varchar' })
  status!: TimeOffRequestStatus;

  @Column({ type: 'varchar', nullable: true })
  decidedBy!: string | null;

  @Column({ type: 'datetime', nullable: true })
  decidedAt!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  hcmTransactionId!: string | null;

  @Column({ type: 'datetime', nullable: true })
  hcmConfirmedAt!: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  rejectionReason!: string | null;

  @Column({ type: 'boolean', default: false })
  balanceDecremented!: boolean;

  @VersionColumn()
  version!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
