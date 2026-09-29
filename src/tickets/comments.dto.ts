import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Comment, TicketHistory, User } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCommentDto {
  @ApiProperty({ example: 'Pode me enviar um print da mensagem de erro?' })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Comentário interno: visível só para a equipe. Cliente não pode criar.',
  })
  @IsOptional()
  @IsBoolean()
  internal = false;
}

class AuthorDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

export class CommentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() body!: string;
  @ApiProperty() internal!: boolean;
  @ApiProperty({ type: AuthorDto }) author!: AuthorDto;
  @ApiProperty() createdAt!: Date;

  static from(c: Comment & { author: Pick<User, 'id' | 'name'> }): CommentResponseDto {
    return {
      id: c.id,
      body: c.body,
      internal: c.internal,
      author: c.author,
      createdAt: c.createdAt,
    };
  }
}

export class HistoryEntryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'status' }) field!: string;
  @ApiProperty({ nullable: true, example: 'ABERTO' }) oldValue!: string | null;
  @ApiProperty({ nullable: true, example: 'EM_ATENDIMENTO' }) newValue!: string | null;
  @ApiProperty({ type: AuthorDto, nullable: true, description: 'null = ação do sistema' })
  actor!: AuthorDto | null;
  @ApiProperty() createdAt!: Date;

  static from(h: TicketHistory & { actor: Pick<User, 'id' | 'name'> | null }): HistoryEntryDto {
    return {
      id: h.id,
      field: h.field,
      oldValue: h.oldValue,
      newValue: h.newValue,
      actor: h.actor,
      createdAt: h.createdAt,
    };
  }
}
