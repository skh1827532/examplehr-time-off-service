import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

@Entity('balances')
@Index('uniq_employee_location', ['employeeId', 'locationId'], { unique: true })
export class Balance {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar' })
  employeeId!: string;

  @Column({ type: 'varchar' })
  locationId!: string;

  @Column({ type: 'real' })
  balanceDays!: number;

  @VersionColumn()
  version!: number;

  @Column({ type: 'datetime', nullable: true })
  hcmUpdatedAt!: Date | null;

  @Column({ type: 'datetime', nullable: true })
  lastSyncedAt!: Date | null;

  @Column({ type: 'varchar', default: 'OK' })
  status!: 'OK' | 'STALE';

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
