import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthUser, CurrentUser, Roles } from '../auth/auth.decorators';
import { CommentResponseDto, CreateCommentDto, HistoryEntryDto } from './comments.dto';
import { CommentsService } from './comments.service';

@ApiTags('tickets')
@ApiBearerAuth()
@Controller('tickets/:id')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Post('comments')
  @ApiCreatedResponse({ type: CommentResponseDto })
  @ApiForbiddenResponse({ description: 'Cliente tentando criar comentário interno' })
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CommentResponseDto> {
    return this.comments.create(id, dto, user);
  }

  @Get('comments')
  @ApiOkResponse({ type: [CommentResponseDto], description: 'Cliente não recebe os internos' })
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<CommentResponseDto[]> {
    return this.comments.list(id, user);
  }

  @Roles('ATENDENTE', 'ADMIN')
  @Get('history')
  @ApiOkResponse({ type: [HistoryEntryDto] })
  history(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<HistoryEntryDto[]> {
    return this.comments.history(id, user);
  }
}
