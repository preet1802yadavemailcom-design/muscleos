import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, MinLength, IsOptional, IsInt, Min, Max, IsArray, ValidateNested, IsUUID } from 'class-validator';

export class CreateExerciseDto {
  @ApiProperty({ example: 'Barbell Bench Press' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: 4 })
  @IsInt()
  @Min(1)
  sets: number;

  @ApiProperty({ example: '8-12', description: 'Free text — allows ranges, AMRAP, time-based holds, etc.' })
  @IsString()
  reps: string;

  @ApiPropertyOptional({ example: '60kg' })
  @IsOptional()
  @IsString()
  weight?: string;

  @ApiPropertyOptional({ description: 'Rest between sets, in seconds' })
  @IsOptional()
  @IsInt()
  @Min(0)
  restSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  order?: number;
}

export class CreateWorkoutDayDto {
  @ApiProperty({ minimum: 0, maximum: 6, description: '0 = Sunday .. 6 = Saturday' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @ApiProperty({ example: 'Push Day' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiProperty({ type: [CreateExerciseDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateExerciseDto)
  exercises: CreateExerciseDto[];
}

export class CreateWorkoutPlanDto {
  @ApiProperty()
  @IsUUID()
  memberId: string;

  @ApiProperty({ example: 'Push/Pull/Legs — 6 day split' })
  @IsString()
  @MinLength(3)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: [CreateWorkoutDayDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateWorkoutDayDto)
  days: CreateWorkoutDayDto[];
}
