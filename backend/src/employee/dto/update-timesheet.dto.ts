import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

export class WorkDayDto {
  @IsDateString({ strict: true })
  date!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(24)
  hours!: number;
}

export class AssignmentHoursDto {
  @IsUUID()
  assignmentId!: string;

  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => WorkDayDto)
  days!: WorkDayDto[];
}

export class UpdateTimesheetDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AssignmentHoursDto)
  entries!: AssignmentHoursDto[];
}
