import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Request } from 'express';

/** Usuário autenticado, extraído do access token pelo JwtAuthGuard. */
export interface AuthUser {
  id: string;
  role: Role;
}

export const IS_PUBLIC = 'isPublic';
/** Libera a rota da autenticação (o JwtAuthGuard é global). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
/** Restringe a rota aos papéis informados (checado pelo RolesGuard). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<Request & { user: AuthUser }>().user,
);
