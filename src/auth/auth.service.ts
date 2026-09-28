import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import { ENV } from '../config/config.module';
import { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { TokenResponseDto } from './auth.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  // Hash "de mentira" para gastar o mesmo tempo quando o e-mail não existe
  private readonly dummyHash = hash('dummy-password-for-timing');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async login(email: string, password: string): Promise<TokenResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Verifica a senha mesmo sem usuário: tempo de resposta não revela se o e-mail existe
    const valid = await verify(user?.passwordHash ?? (await this.dummyHash), password);
    if (!user || !valid || !user.active) {
      throw new UnauthorizedException('E-mail ou senha inválidos');
    }
    return this.issueTokens(user);
  }

  /**
   * Rotação: cada refresh token só pode ser usado uma vez.
   * Se um token já revogado for reapresentado, alguém pode tê-lo roubado:
   * revogamos todas as sessões do usuário.
   */
  async refresh(refreshToken: string): Promise<TokenResponseDto> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!stored) throw new UnauthorizedException('Refresh token inválido');

    if (stored.revokedAt) {
      await this.revokeAll(stored.userId);
      throw new UnauthorizedException('Refresh token já utilizado; sessões encerradas');
    }
    if (stored.expiresAt < new Date() || !stored.user.active) {
      throw new UnauthorizedException('Refresh token expirado');
    }

    // updateMany com revokedAt: null evita que duas requisições simultâneas usem o mesmo token
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new UnauthorizedException('Refresh token já utilizado');

    return this.issueTokens(stored.user);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async revokeAll(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(user: User): Promise<TokenResponseDto> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role },
      { expiresIn: this.env.JWT_ACCESS_TTL_SECONDS },
    );
    // Refresh token opaco (não é JWT); no banco guardamos só o hash
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * DAY_MS),
      },
    });
    return { accessToken, refreshToken, expiresIn: this.env.JWT_ACCESS_TTL_SECONDS };
  }
}
