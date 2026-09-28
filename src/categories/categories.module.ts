import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  PartialType,
} from '@nestjs/swagger';
import { Category } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Roles } from '../auth/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';

// Módulo pequeno: DTOs, service e controller no mesmo arquivo por simplicidade.

export class CreateCategoryDto {
  @ApiProperty({ example: 'Financeiro' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;
}

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<Category[]> {
    return this.prisma.category.findMany({ orderBy: { name: 'asc' } });
  }

  // Nome duplicado → P2002 → 409 pelo ProblemDetailsFilter; id inexistente → P2025 → 404
  create(dto: CreateCategoryDto): Promise<Category> {
    return this.prisma.category.create({ data: dto });
  }

  update(id: string, dto: UpdateCategoryDto): Promise<Category> {
    return this.prisma.category.update({ where: { id }, data: dto });
  }
}

@ApiTags('categories')
@ApiBearerAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  findAll(): Promise<Category[]> {
    return this.categories.findAll();
  }

  @Roles('ADMIN')
  @Post()
  create(@Body() dto: CreateCategoryDto): Promise<Category> {
    return this.categories.create(dto);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<Category> {
    return this.categories.update(id, dto);
  }
}

@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
