import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Roles } from '../auth/auth.decorators';
import { CorrectTriageDto, TriageResponseDto } from './triage.dto';
import { TriageDecisionService } from './triage-decision.service';

@ApiTags('triage')
@ApiBearerAuth()
@Roles('ATENDENTE', 'ADMIN')
@Controller('tickets/:id/triage')
export class TriageController {
  constructor(private readonly triage: TriageDecisionService) {}

  @Get()
  @ApiOkResponse({ type: TriageResponseDto })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<TriageResponseDto> {
    return this.triage.get(id, user);
  }

  @Post('accept')
  @HttpCode(200)
  @ApiOkResponse({ type: TriageResponseDto, description: 'Aplica a sugestão ao chamado' })
  @ApiConflictResponse({ description: 'Sugestão ainda pendente ou já decidida' })
  accept(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<TriageResponseDto> {
    return this.triage.accept(id, user);
  }

  @Post('correct')
  @HttpCode(200)
  @ApiOkResponse({ type: TriageResponseDto, description: 'Aplica a correção do atendente' })
  @ApiConflictResponse({ description: 'Sugestão ainda pendente ou já decidida' })
  correct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectTriageDto,
    @CurrentUser() user: AuthUser,
  ): Promise<TriageResponseDto> {
    return this.triage.correct(id, dto, user);
  }
}
