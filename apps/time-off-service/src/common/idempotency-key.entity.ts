import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('idempotency_keys')
export class IdempotencyKey {
  @PrimaryColumn({ type: 'varchar' })
  key!: string;

  @Column({ type: 'varchar' })
  scope!: string;

  @Column({ type: 'varchar' })
  payloadHash!: string;

  @Column({ type: 'simple-json' })
  response!: Record<string, unknown>;

  @Column({ type: 'integer' })
  statusCode!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
