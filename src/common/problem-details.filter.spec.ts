import { ArgumentsHost, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProblemDetailsFilter } from './problem-details.filter';

function mockHost() {
  const res = { status: jest.fn(), type: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.type.mockReturnValue(res);
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ originalUrl: '/tickets/1' }),
      getResponse: () => res,
    }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('ProblemDetailsFilter', () => {
  const filter = new ProblemDetailsFilter();

  it('converte HttpException em problem+json', () => {
    const { host, res } = mockHost();
    filter.catch(new UnprocessableEntityException('Transição inválida'), host);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.type).toHaveBeenCalledWith('application/problem+json');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 422,
        detail: 'Transição inválida',
        instance: '/tickets/1',
      }),
    );
  });

  it('mapeia violação de UNIQUE do Prisma (P2002) para 409', () => {
    const { host, res } = mockHost();
    const err = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'x',
    });
    filter.catch(err, host);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('esconde detalhes de erros inesperados (500 genérico)', () => {
    const { host, res } = mockHost();
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
    filter.catch(new Error('senha do banco: 123'), host);
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain('senha');
  });

  it('mantém a mensagem de 404', () => {
    const { host, res } = mockHost();
    filter.catch(new NotFoundException('Chamado não encontrado'), host);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ detail: 'Chamado não encontrado' }),
    );
  });
});
