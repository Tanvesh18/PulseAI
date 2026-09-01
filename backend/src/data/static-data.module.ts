import { Global, Module } from "@nestjs/common";
import { StaticDataService } from "./static-data.service";

@Global()
@Module({ providers: [StaticDataService], exports: [StaticDataService] })
export class StaticDataModule {}
