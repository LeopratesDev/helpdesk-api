import { Module } from '@nestjs/common';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  controllers: [TicketsController, CommentsController],
  providers: [TicketsService, CommentsService],
  exports: [TicketsService],
})
export class TicketsModule {}
