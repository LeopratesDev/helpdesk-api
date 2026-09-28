import { ApiProperty, ApiPropertyOptional, PartialType, PickType } from '@nestjs/swagger';
import { Role, User } from '@prisma/client';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'Maria Souza' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'maria@empresa.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Senha@123', description: 'Mínimo 8 caracteres, com letra e número' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'password deve conter letras e números' })
  password!: string;

  @ApiProperty({ enum: Role, example: Role.ATENDENTE })
  @IsEnum(Role)
  role!: Role;
}

export class UpdateUserDto extends PartialType(PickType(CreateUserDto, ['name', 'role'] as const)) {
  @ApiPropertyOptional({ description: 'false desativa o usuário (não consegue mais logar)' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** O que sai da API: nunca expõe passwordHash. */
export class UserResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: Role }) role!: Role;
  @ApiProperty() active!: boolean;
  @ApiProperty() createdAt!: Date;

  static from(user: User): UserResponseDto {
    const { id, name, email, role, active, createdAt } = user;
    return { id, name, email, role, active, createdAt };
  }
}
