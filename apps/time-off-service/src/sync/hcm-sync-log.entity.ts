import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type SyncDirection = 'INBOUND' | 'OUTBOUND';
export type SyncKind = 'REALTIME' | 'BATCH' | 'WEBHOOK' | 'SUBMIT' | 'PULL';
export type SyncResult = 'OK' | 'DRIFT' | 'ERROR' | 'CREATED' | 'STALE';

@Entity('hcm_sync_log')
@Index('idx_sync_employee_location', ['employeeId', 'locationId'])
@Index('idx_sync_created', ['createdAt'])
export class HcmSyncLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar' })
  direction!: SyncDirection;

  @Column({ type: 'varchar' })
  kind!: SyncKind;

  @Column({ type: 'varchar', nullable: true })
  employeeId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  locationId!: string | null;

  @Column({ type: 'simple-json', nullable: true })
  payload!: Record<string, unknown> | null;

  @Column({ type: 'varchar' })
  result!: SyncResult;

  @Column({ type: 'text', nullable: true })
  detail!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
