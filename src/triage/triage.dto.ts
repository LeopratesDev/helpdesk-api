import { ApiProperty } from '@nestjs/swagger';
import { Priority, TriageStatus, TriageSuggestion } from '@prisma/client';
import { IsEnum, IsUUID } from 'class-validator';

export class CorrectTriageDto {
  @ApiProperty({ enum: Priority, example: Priority.ALTA })
  @IsEnum(Priority)
  priority!: Priority;

  @ApiProperty({ description: 'Categoria correta (id)' })
  @IsUUID()
  categoryId!: string;
}

export class TriageResponseDto {
  @ApiProperty({
    enum: TriageStatus,
    description: 'PENDING = aguardando IA; SUGGESTED = pronta para decisão',
  })
  status!: TriageStatus;
  @ApiProperty({ nullable: true, example: 'Financeiro' }) suggestedCategory!: string | null;
  @ApiProperty({ enum: Priority, nullable: true }) suggestedPriority!: Priority | null;
  @ApiProperty({ nullable: true, example: 'Cliente cobrado duas vezes no cartão' })
  summary!: string | null;
  @ApiProperty({ nullable: true, example: 0.82 }) confidence!: number | null;
  @ApiProperty({ nullable: true, description: 'Texto enviado ao modelo' })
  inputText!: string | null;
  @ApiProperty({ nullable: true, example: 'claude-haiku-4-5' }) model!: string | null;
  @ApiProperty() attempts!: number;
  @ApiProperty({ nullable: true }) error!: string | null;
  @ApiProperty({ nullable: true }) finalCategory!: string | null;
  @ApiProperty({ enum: Priority, nullable: true }) finalPriority!: Priority | null;
  @ApiProperty({ nullable: true }) decidedAt!: Date | null;

  static from(s: TriageSuggestion): TriageResponseDto {
    return {
      status: s.status,
      suggestedCategory: s.suggestedCategory,
      suggestedPriority: s.suggestedPriority,
      summary: s.summary,
      confidence: s.confidence,
      inputText: s.inputText,
      model: s.model,
      attempts: s.attempts,
      error: s.error,
      finalCategory: s.finalCategory,
      finalPriority: s.finalPriority,
      decidedAt: s.decidedAt,
    };
  }
}
