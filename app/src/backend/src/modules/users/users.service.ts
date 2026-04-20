import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { DATABASE } from '../../database/database.module';
import { Db } from '../../database/connection';
import { users } from '../../database/schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  async findAll() {
    return this.db.select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      accessStatus: users.accessStatus,
      createdAt: users.createdAt,
    }).from(users);
  }

  async findById(id: number) {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }
}
