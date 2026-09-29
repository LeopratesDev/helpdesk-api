import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, Ticket } from '@prisma/client';
import { AuthUser } from '../auth/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { computeSlaDueAt, isSlaBreached } from '../sla/sla.policy';
import { canTransition, transitionEffects } from './ticket-status';
import {
  AssignTicketDto,
  ChangeStatusDto,
  CreateTicketDto,
  ListTicketsQueryDto,
  TicketPageDto,
  TicketResponseDto,
  UpdateTicketDto,
} from './tickets.dto';

const include = {
  category: { select: { id: true, name: true } },
  requester: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
} satisfies Prisma.TicketInclude;

export type TicketWithRelations = Prisma.TicketGetPayload<{ include: typeof include }>;

type HistoryEntry = { field: string; oldValue: string | null; newValue: string | null };

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTicketDto, user: AuthUser): Promise<TicketResponseDto> {
    if (dto.categoryId) await this.assertActiveCategory(dto.categoryId);
    const now = new Date();
    const priority = 'MEDIA';

    // Chamado e primeira linha do histórico na mesma transação (create aninhado)
    const ticket = await this.prisma.ticket.create({
      data: {
        title: dto.title,
        description: dto.description,
        priority,
        categoryId: dto.categoryId,
        requesterId: user.id,
        slaDueAt: computeSlaDueAt(priority, now),
        createdAt: now,
        history: { create: { field: 'status', newValue: 'ABERTO', actorId: user.id } },
      },
      include,
    });
    return TicketResponseDto.from(ticket);
  }

  async list(query: ListTicketsQueryDto, user: AuthUser): Promise<TicketPageDto> {
    const where: Prisma.TicketWhereInput = {
      status: query.status,
      priority: query.priority,
      categoryId: query.categoryId,
      assigneeId: query.assigneeId,
      createdAt: query.from || query.to ? { gte: query.from, lte: query.to } : undefined,
      // Cliente só enxerga os próprios chamados, independentemente dos filtros
      requesterId: user.role === 'CLIENTE' ? user.id : undefined,
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.findMany({
        where,
        include,
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      data: rows.map((t) => TicketResponseDto.from(t)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async findOne(id: string, user: AuthUser): Promise<TicketResponseDto> {
    return TicketResponseDto.from(await this.getVisible(id, user));
  }

  /** Busca o chamado respeitando a visibilidade: cliente de outro chamado recebe 404, não 403. */
  async getVisible(id: string, user: AuthUser): Promise<TicketWithRelations> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id }, include });
    if (!ticket || (user.role === 'CLIENTE' && ticket.requesterId !== user.id)) {
      throw new NotFoundException('Chamado não encontrado');
    }
    return ticket;
  }

  async changeStatus(id: string, dto: ChangeStatusDto, user: AuthUser): Promise<TicketResponseDto> {
    const ticket = await this.getVisible(id, user);
    if (!canTransition(ticket.status, dto.status)) {
      throw new UnprocessableEntityException(
        `Transição de ${ticket.status} para ${dto.status} não é permitida`,
      );
    }

    const data: Prisma.TicketUncheckedUpdateInput = {
      status: dto.status,
      ...transitionEffects(ticket.status, dto.status, !!ticket.firstResponseAt, new Date()),
    };
    if (data.firstResponseAt instanceof Date && !ticket.slaBreached) {
      data.slaBreached = isSlaBreached(ticket.slaDueAt, data.firstResponseAt, data.firstResponseAt);
    }
    const history: HistoryEntry[] = [
      { field: 'status', oldValue: ticket.status, newValue: dto.status },
    ];
    // Quem assume o atendimento vira responsável, se ainda não houver um
    if (dto.status === 'EM_ATENDIMENTO' && !ticket.assigneeId) {
      data.assigneeId = user.id;
      history.push({ field: 'assigneeId', oldValue: null, newValue: user.id });
    }

    return this.updateWithHistory(ticket, data, history, user);
  }

  async assign(id: string, dto: AssignTicketDto, user: AuthUser): Promise<TicketResponseDto> {
    const ticket = await this.getVisible(id, user);
    if (ticket.status === 'FECHADO') {
      throw new UnprocessableEntityException('Chamado fechado não pode ser reatribuído');
    }
    const assignee = await this.prisma.user.findUnique({ where: { id: dto.assigneeId } });
    if (!assignee || !assignee.active || assignee.role === 'CLIENTE') {
      throw new UnprocessableEntityException('Responsável deve ser um Atendente ou Admin ativo');
    }
    if (ticket.assigneeId === dto.assigneeId) return TicketResponseDto.from(ticket);

    return this.updateWithHistory(
      ticket,
      { assigneeId: dto.assigneeId },
      [{ field: 'assigneeId', oldValue: ticket.assigneeId, newValue: dto.assigneeId }],
      user,
    );
  }

  async update(id: string, dto: UpdateTicketDto, user: AuthUser): Promise<TicketResponseDto> {
    const ticket = await this.getVisible(id, user);
    if (ticket.status === 'FECHADO') {
      throw new UnprocessableEntityException('Chamado fechado não pode ser alterado');
    }
    if (dto.categoryId) await this.assertActiveCategory(dto.categoryId);

    const data: Prisma.TicketUncheckedUpdateInput = {};
    const history: HistoryEntry[] = [];
    if (dto.priority && dto.priority !== ticket.priority) {
      data.priority = dto.priority;
      history.push({ field: 'priority', oldValue: ticket.priority, newValue: dto.priority });
      // Sem primeira resposta ainda, o prazo acompanha a nova prioridade
      if (!ticket.firstResponseAt) {
        const slaDueAt = computeSlaDueAt(dto.priority, ticket.createdAt);
        data.slaDueAt = slaDueAt;
        data.slaBreached = slaDueAt < new Date();
      }
    }
    if (dto.categoryId && dto.categoryId !== ticket.categoryId) {
      data.categoryId = dto.categoryId;
      history.push({ field: 'categoryId', oldValue: ticket.categoryId, newValue: dto.categoryId });
    }
    if (history.length === 0) return TicketResponseDto.from(ticket);

    return this.updateWithHistory(ticket, data, history, user);
  }

  /**
   * Atualiza o chamado e grava o histórico numa única transação.
   * O "where" inclui o updatedAt lido: se outra requisição mudou o chamado
   * nesse meio-tempo, nenhuma linha é afetada e respondemos 409 (lock otimista).
   */
  private async updateWithHistory(
    ticket: Ticket,
    data: Prisma.TicketUncheckedUpdateInput,
    history: HistoryEntry[],
    user: AuthUser,
  ): Promise<TicketResponseDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.ticket.updateMany({
        where: { id: ticket.id, updatedAt: ticket.updatedAt },
        data,
      });
      if (count === 0) {
        throw new ConflictException(
          'O chamado foi alterado por outra pessoa; recarregue e tente de novo',
        );
      }
      await tx.ticketHistory.createMany({
        data: history.map((h) => ({ ...h, ticketId: ticket.id, actorId: user.id })),
      });
      return tx.ticket.findUniqueOrThrow({ where: { id: ticket.id }, include });
    });
    return TicketResponseDto.from(updated);
  }

  private async assertActiveCategory(categoryId: string): Promise<void> {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category?.active)
      throw new UnprocessableEntityException('Categoria inexistente ou inativa');
  }
}
