import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { AuthUser, CurrentUser, Roles } from '../auth/auth.decorators';
import {
  AssignTicketDto,
  ChangeStatusDto,
  CreateTicketDto,
  ListTicketsQueryDto,
  TicketPageDto,
  TicketResponseDto,
  UpdateTicketDto,
} from './tickets.dto';
import { TicketsService } from './tickets.service';

/** Controller fino: só traduz HTTP → service. Regras ficam no service e em ticket-status.ts. */
@ApiTags('tickets')
@ApiBearerAuth()
@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Roles('CLIENTE')
  @Post()
  @ApiCreatedResponse({ type: TicketResponseDto })
  create(@Body() dto: CreateTicketDto, @CurrentUser() user: AuthUser): Promise<TicketResponseDto> {
    return this.tickets.create(dto, user);
  }

  @Get()
  @ApiOkResponse({ type: TicketPageDto, description: 'Cliente vê só os próprios chamados' })
  list(@Query() query: ListTicketsQueryDto, @CurrentUser() user: AuthUser): Promise<TicketPageDto> {
    return this.tickets.list(query, user);
  }

  @Get(':id')
  @ApiOkResponse({ type: TicketResponseDto })
  @ApiNotFoundResponse()
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<TicketResponseDto> {
    return this.tickets.findOne(id, user);
  }

  @Roles('ATENDENTE', 'ADMIN')
  @Patch(':id')
  @ApiOkResponse({ type: TicketResponseDto, description: 'Altera prioridade e/ou categoria' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketDto,
    @CurrentUser() user: AuthUser,
  ): Promise<TicketResponseDto> {
    return this.tickets.update(id, dto, user);
  }

  @Roles('ATENDENTE', 'ADMIN')
  @Patch(':id/status')
  @ApiOkResponse({ type: TicketResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'Transição de status não permitida' })
  @ApiConflictResponse({ description: 'Chamado alterado por outra pessoa ao mesmo tempo' })
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
    @CurrentUser() user: AuthUser,
  ): Promise<TicketResponseDto> {
    return this.tickets.changeStatus(id, dto, user);
  }

  @Roles('ATENDENTE', 'ADMIN')
  @Patch(':id/assign')
  @ApiOkResponse({ type: TicketResponseDto })
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTicketDto,
    @CurrentUser() user: AuthUser,
  ): Promise<TicketResponseDto> {
    return this.tickets.assign(id, dto, user);
  }
}
