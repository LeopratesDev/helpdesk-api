import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsService } from './tickets.service';

const ticket = {
  id: 't1',
  status: 'ABERTO',
  priority: 'MEDIA',
  assigneeId: null,
  requesterId: 'c1',
  categoryId: null,
  firstResponseAt: null,
  slaDueAt: new Date('2026-01-02T00:00:00Z'),
  slaBreached: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};
const atendente = { id: 'a1', role: 'ATENDENTE' as const };

function setup(updatedCount: number) {
  const tx = {
    ticket: {
      updateMany: jest.fn().mockResolvedValue({ count: updatedCount }),
      findUniqueOrThrow: jest.fn(),
    },
    ticketHistory: { createMany: jest.fn() },
  };
  const prisma = {
    ticket: { findUnique: jest.fn().mockResolvedValue(ticket) },
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { service: new TicketsService(prisma as unknown as PrismaService), tx };
}

describe('TicketsService — lock otimista', () => {
  it('responde 409 e não grava histórico se o chamado mudou entre a leitura e a escrita', async () => {
    // updateMany com where { updatedAt } não encontra a linha: outra requisição chegou antes
    const { service, tx } = setup(0);

    await expect(
      service.changeStatus('t1', { status: 'EM_ATENDIMENTO' }, atendente),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.ticketHistory.createMany).not.toHaveBeenCalled();
  });

  it('valida a transição antes de abrir a transação', async () => {
    const { service, tx } = setup(1);
    await expect(
      service.changeStatus('t1', { status: 'FECHADO' }, atendente),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(tx.ticket.updateMany).not.toHaveBeenCalled();
  });
});
