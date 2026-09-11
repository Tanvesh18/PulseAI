import { Injectable, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    const connectionString = config.get<string>("DATABASE_URL");
    if (!connectionString || !/^postgres(ql)?:\/\//.test(connectionString)) {
      throw new Error("Set DATABASE_URL in backend/.env to your hosted PostgreSQL connection URL.");
    }
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
