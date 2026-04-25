import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('employees')
export class Employee {
  @PrimaryColumn({ type: 'varchar' })
  employeeId!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar', nullable: true })
  defaultLocationId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
