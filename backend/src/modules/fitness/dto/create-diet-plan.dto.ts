import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, MinLength, IsOptional, IsIn, IsInt, Min, IsArray, ValidateNested, IsUUID } from 'class-validator';

export class CreateMealDto {
  @ApiProperty({ enum: ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK', 'PRE_WORKOUT', 'POST_WORKOUT'] })
  @IsIn(['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK', 'PRE_WORKOUT', 'POST_WORKOUT'])
  mealType: string;

  @ApiProperty({ example: 'Oats with banana and peanut butter' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  calories?: number;

  @ApiPropertyOptional({ description: 'grams' })
  @IsOptional()
  @IsInt()
  @Min(0)
  protein?: number;

  @ApiPropertyOptional({ description: 'grams' })
  @IsOptional()
  @IsInt()
  @Min(0)
  carbs?: number;

  @ApiPropertyOptional({ description: 'grams' })
  @IsOptional()
  @IsInt()
  @Min(0)
  fats?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  order?: number;
}

export class CreateDietPlanDto {
  @ApiProperty()
  @IsUUID()
  memberId: string;

  @ApiProperty({ example: 'Cutting phase — Week 1-4' })
  @IsString()
  @MinLength(3)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: [CreateMealDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateMealDto)
  meals: CreateMealDto[];
}
