import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "./data/database.module";
import { EmployeeModule } from "./employee/employee.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    EmployeeModule,
  ],
})
export class AppModule {}
