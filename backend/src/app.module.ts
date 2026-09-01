import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { StaticDataModule } from "./data/static-data.module";
import { EmployeeModule } from "./employee/employee.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    StaticDataModule,
    EmployeeModule,
  ],
})
export class AppModule {}
