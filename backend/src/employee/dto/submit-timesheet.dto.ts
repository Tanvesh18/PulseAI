import { IsInt, Min } from "class-validator";

export class SubmitTimesheetDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
