import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Priority, TicketStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { TicketWithRelations } from './tickets.service';

export class CreateTicketDto {
  @ApiProperty({ example: 'Não consigo emitir nota fiscal' })
  @IsString()
  @MinLength(5)
  @MaxLength(150)
  title!: string;

  @ApiProperty({ example: 'Ao clicar em "Emitir", aparece erro 500 desde ontem às 14h.' })
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description!: string;

  @ApiPropertyOptional({ description: 'Opcional: a IA sugere se o cliente não souber' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export class UpdateTicketDto {
  @ApiPropertyOptional({ enum: Priority })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export class ChangeStatusDto {
  @ApiProperty({ enum: TicketStatus, example: TicketStatus.EM_ATENDIMENTO })
  @IsEnum(TicketStatus)
  status!: TicketStatus;
}

export class AssignTicketDto {
  @ApiProperty({ description: 'Id de um Atendente ou Admin ativo' })
  @IsUUID()
  assigneeId!: string;
}

export const SORT_FIELDS = ['createdAt', 'updatedAt', 'priority', 'slaDueAt'] as const;

export class ListTicketsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional({ enum: TicketStatus })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @ApiPropertyOptional({ enum: Priority })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional({ description: 'Abertos a partir de (ISO 8601)', example: '2026-01-01' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ description: 'Abertos até (ISO 8601)', example: '2026-12-31' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @ApiPropertyOptional({ enum: SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy: (typeof SORT_FIELDS)[number] = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}

class RefDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

export class TicketResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: Priority }) priority!: Priority;
  @ApiProperty({ enum: TicketStatus }) status!: TicketStatus;
  @ApiProperty({ type: RefDto, nullable: true }) category!: RefDto | null;
  @ApiProperty({ type: RefDto }) requester!: RefDto;
  @ApiProperty({ type: RefDto, nullable: true }) assignee!: RefDto | null;
  @ApiProperty() slaDueAt!: Date;
  @ApiProperty() slaBreached!: boolean;
  @ApiProperty({ nullable: true }) firstResponseAt!: Date | null;
  @ApiProperty({ nullable: true }) resolvedAt!: Date | null;
  @ApiProperty({ nullable: true }) closedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static from(t: TicketWithRelations): TicketResponseDto {
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      priority: t.priority,
      status: t.status,
      category: t.category,
      requester: t.requester,
      assignee: t.assignee,
      slaDueAt: t.slaDueAt,
      slaBreached: t.slaBreached,
      firstResponseAt: t.firstResponseAt,
      resolvedAt: t.resolvedAt,
      closedAt: t.closedAt,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }
}

class PageMetaDto {
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

export class TicketPageDto {
  @ApiProperty({ type: [TicketResponseDto] }) data!: TicketResponseDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
}
