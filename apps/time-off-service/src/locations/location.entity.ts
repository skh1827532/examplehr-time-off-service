import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('locations')
export class Location {
  @PrimaryColumn({ type: 'varchar' })
  locationId!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar' })
  country!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
