import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'atendente@helpdesk.dev' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Demo@123' })
  @IsString()
  @MinLength(1)
  password!: string;
}

export class RefreshDto {
  @ApiProperty({ description: 'Refresh token recebido no login ou no último refresh' })
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

export class TokenResponseDto {
  @ApiProperty({ description: 'JWT de curta duração; envie como "Authorization: Bearer ..."' })
  accessToken!: string;

  @ApiProperty({
    description: 'Token opaco de longa duração; troque por um novo par em /auth/refresh',
  })
  refreshToken!: string;

  @ApiProperty({ example: 900, description: 'Validade do access token, em segundos' })
  expiresIn!: number;
}
