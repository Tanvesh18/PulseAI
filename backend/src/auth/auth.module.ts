import { Module } from "@nestjs/common";
import { EmployeeAuthGuard } from "./employee-auth.guard";

@Module({ providers: [EmployeeAuthGuard], exports: [EmployeeAuthGuard] })
export class AuthModule {}
