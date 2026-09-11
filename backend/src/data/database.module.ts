import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { EmployeeRepository } from "./employee.repository";

@Global()
@Module({ providers: [PrismaService, EmployeeRepository], exports: [PrismaService, EmployeeRepository] })
export class DatabaseModule {}
