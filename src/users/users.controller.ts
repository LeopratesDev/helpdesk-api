import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/auth.decorators';
import { CreateUserDto, UpdateUserDto, UserResponseDto } from './users.dto';
import { UsersService } from './users.service';

/** Gestão de usuários: só Admin. Não há DELETE: desativar preserva o histórico dos chamados. */
@ApiTags('users')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @ApiConflictResponse({ description: 'E-mail já cadastrado' })
  create(@Body() dto: CreateUserDto): Promise<UserResponseDto> {
    return this.users.create(dto);
  }

  @Get()
  findAll(): Promise<UserResponseDto[]> {
    return this.users.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    return this.users.findById(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    return this.users.update(id, dto);
  }
}
