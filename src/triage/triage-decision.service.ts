import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, Priority, TriageSuggestion } from '@prisma/client';
import { AuthUser } from '../auth/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsService } from '../tickets/tickets.service';
import { CorrectTriageDto, TriageResponseDto } from './triage.dto';

/** Lado da API: o atendente consulta, aceita ou corrige a sugestão da IA. */
@Injectable()
export class TriageDecisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
  ) {}

  async get(ticketId: string, user: AuthUser): Promise<TriageResponseDto> {
    await this.tickets.getVisible(ticketId, user);
    return TriageResponseDto.from(await this.find(ticketId));
  }

  /** Aplica prioridade e categoria sugeridas ao chamado. Conta como "acerto" da IA. */
  async accept(ticketId: string, user: AuthUser): Promise<TriageResponseDto> {
    const suggestion = await this.findSuggested(ticketId);
    const category = await this.prisma.category.findFirst({
      where: { name: suggestion.suggestedCategory ?? '', active: true },
    });
    if (!category) throw new UnprocessableEntityException('Categoria sugerida não existe mais');

    const priority = suggestion.suggestedPriority as Priority;
    await this.tickets.update(ticketId, { priority, categoryId: category.id }, user, (tx) =>
      this.decide(tx, ticketId, 'ACCEPTED', category.name, priority, user),
    );
    return TriageResponseDto.from(await this.find(ticketId));
  }

  /** O atendente discorda: aplica os valores dele e registra a correção. */
  async correct(
    ticketId: string,
    dto: CorrectTriageDto,
    user: AuthUser,
  ): Promise<TriageResponseDto> {
    await this.findSuggested(ticketId);
    const category = await this.prisma.category.findUnique({ where: { id: dto.categoryId } });
    if (!category?.active)
      throw new UnprocessableEntityException('Categoria inexistente ou inativa');

    await this.tickets.update(ticketId, dto, user, (tx) =>
      this.decide(tx, ticketId, 'CORRECTED', category.name, dto.priority, user),
    );
    return TriageResponseDto.from(await this.find(ticketId));
  }

  /**
   * Roda dentro da transação da atualização do chamado.
   * WHERE status = SUGGESTED: se duas pessoas decidirem ao mesmo tempo, a segunda
   * recebe 409 e a transação inteira (inclusive a mudança no chamado) é desfeita.
   */
  private async decide(
    tx: Prisma.TransactionClient,
    ticketId: string,
    status: 'ACCEPTED' | 'CORRECTED',
    finalCategory: string,
    finalPriority: Priority,
    user: AuthUser,
  ): Promise<void> {
    const { count } = await tx.triageSuggestion.updateMany({
      where: { ticketId, status: 'SUGGESTED' },
      data: { status, finalCategory, finalPriority, decidedById: user.id, decidedAt: new Date() },
    });
    if (count === 0) throw new ConflictException('A sugestão já foi decidida');
    await tx.ticketHistory.create({
      data: { ticketId, actorId: user.id, field: 'triage', newValue: status },
    });
  }

  private async findSuggested(ticketId: string): Promise<TriageSuggestion> {
    const suggestion = await this.find(ticketId);
    if (suggestion.status !== 'SUGGESTED') {
      throw new ConflictException(`Sugestão está ${suggestion.status}, não pode ser decidida`);
    }
    return suggestion;
  }

  private async find(ticketId: string): Promise<TriageSuggestion> {
    const suggestion = await this.prisma.triageSuggestion.findUnique({ where: { ticketId } });
    if (!suggestion) throw new NotFoundException('Chamado sem triagem');
    return suggestion;
  }
}
