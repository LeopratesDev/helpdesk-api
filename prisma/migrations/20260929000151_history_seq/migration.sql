-- DropIndex
DROP INDEX "TicketHistory_ticketId_createdAt_idx";

-- AlterTable
ALTER TABLE "TicketHistory" ADD COLUMN     "seq" SERIAL NOT NULL;

-- CreateIndex
CREATE INDEX "TicketHistory_ticketId_seq_idx" ON "TicketHistory"("ticketId", "seq");
