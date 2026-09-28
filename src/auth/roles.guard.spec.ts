import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard';

function ctxWith(role?: Role): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user: role ? { id: '1', role } : undefined }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  it('libera quando a rota não exige papel', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(ctxWith('CLIENTE'))).toBe(true);
  });

  it('libera quando o usuário tem um dos papéis exigidos', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ATENDENTE', 'ADMIN']);
    expect(guard.canActivate(ctxWith('ADMIN'))).toBe(true);
  });

  it('lança 403 quando o papel não é permitido', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    expect(() => guard.canActivate(ctxWith('CLIENTE'))).toThrow(ForbiddenException);
  });
});
