import { ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { AuthUser } from '../auth/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { CommentResponseDto, CreateCommentDto, HistoryEntryDto } from './comments.dto';
import { TicketsService } from './tickets.service';

const author = { select: { id: true, name: true } } as const;

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
  ) {}

  async create(
    ticketId: string,
    dto: CreateCommentDto,
    user: AuthUser,
  ): Promise<CommentResponseDto> {
    const ticket = await this.tickets.getVisible(ticketId, user);
    const isStaff = user.role !== 'CLIENTE';

    if (dto.internal && !isStaff) {
      throw new ForbiddenException('Cliente não pode criar comentário interno');
    }
    if (ticket.status === 'FECHADO') {
      throw new UnprocessableEntityException('Chamado fechado não aceita comentários');
    }

    // Primeira resposta pública da equipe conta para o SLA
    const isFirstResponse = isStaff && !dto.internal && !ticket.firstResponseAt;

    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: { ticketId, authorId: user.id, body: dto.body, internal: dto.internal },
        include: { author },
      });
      const history = [{ field: 'comment', newValue: dto.internal ? 'interno' : 'público' }];
      if (isFirstResponse) {
        // where com firstResponseAt: null: se outra requisição marcou antes, não sobrescreve
        const { count } = await tx.ticket.updateMany({
          where: { id: ticketId, firstResponseAt: null },
          data: { firstResponseAt: created.createdAt },
        });
        if (count === 1) {
          history.push({ field: 'firstResponseAt', newValue: created.createdAt.toISOString() });
        }
      }
      await tx.ticketHistory.createMany({
        data: history.map((h) => ({ ...h, ticketId, actorId: user.id })),
      });
      return created;
    });

    return CommentResponseDto.from(comment);
  }

  async list(ticketId: string, user: AuthUser): Promise<CommentResponseDto[]> {
    await this.tickets.getVisible(ticketId, user);
    const comments = await this.prisma.comment.findMany({
      // Cliente nunca recebe comentários internos
      where: { ticketId, internal: user.role === 'CLIENTE' ? false : undefined },
      include: { author },
      orderBy: { createdAt: 'asc' },
    });
    return comments.map((c) => CommentResponseDto.from(c));
  }

  async history(ticketId: string, user: AuthUser): Promise<HistoryEntryDto[]> {
    await this.tickets.getVisible(ticketId, user);
    const entries = await this.prisma.ticketHistory.findMany({
      where: { ticketId },
      include: { actor: author },
      orderBy: { seq: 'asc' },
    });
    return entries.map((h) => HistoryEntryDto.from(h));
  }
}
