import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

/** Corpo de erro no formato RFC 7807 (application/problem+json). */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance: string;
  errors?: unknown;
}

const TITLES: Record<number, string> = {
  400: 'Requisição inválida',
  401: 'Não autenticado',
  403: 'Acesso negado',
  404: 'Recurso não encontrado',
  409: 'Conflito',
  422: 'Regra de negócio violada',
  429: 'Muitas requisições',
  500: 'Erro interno',
};

/**
 * Converte qualquer exceção em ProblemDetails.
 * Erros inesperados viram 500 genérico: o detalhe vai só para o log, nunca para o cliente.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const problem = this.toProblem(exception, req.originalUrl);
    if (problem.status >= 500) this.logger.error(exception);

    res.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exception: unknown, instance: string): ProblemDetails {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      let detail: string | undefined;
      let errors: unknown;
      if (typeof body === 'string') {
        detail = body;
      } else {
        const b = body as { message?: unknown; errors?: unknown };
        if (typeof b.message === 'string') detail = b.message;
        errors = b.errors;
      }
      return this.build(status, instance, detail, errors);
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return this.build(HttpStatus.CONFLICT, instance, 'Registro duplicado');
      }
      if (exception.code === 'P2025') {
        return this.build(HttpStatus.NOT_FOUND, instance);
      }
    }

    return this.build(HttpStatus.INTERNAL_SERVER_ERROR, instance);
  }

  private build(
    status: number,
    instance: string,
    detail?: string,
    errors?: unknown,
  ): ProblemDetails {
    return {
      type: `https://httpstatuses.io/${status}`,
      title: TITLES[status] ?? 'Erro',
      status,
      ...(detail ? { detail } : {}),
      instance,
      ...(errors ? { errors } : {}),
    };
  }
}
