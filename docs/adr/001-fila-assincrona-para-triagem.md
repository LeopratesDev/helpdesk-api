# ADR 001 — Fila assíncrona para a triagem por IA

- **Status:** aceita
- **Data:** 2026-09-29

## Contexto

Ao abrir um chamado, a IA (Claude) sugere categoria, prioridade e um resumo. Uma chamada ao LLM leva segundos, pode estourar timeout, receber limite de taxa (429), falhar (5xx) ou devolver uma resposta fora do formato. O cliente que abre o chamado não deveria esperar nem ver nenhum desses problemas.

## Decisão

A API grava o chamado (com a sugestão em `PENDING`) numa transação, responde **201** imediatamente e publica um job numa fila **BullMQ (Redis)**. Um **processo worker** separado consome o job, chama o LLM com timeout, valida a resposta com Zod e grava a sugestão.

- Retry com **backoff exponencial** (`TRIAGE_MAX_ATTEMPTS`, `TRIAGE_BACKOFF_MS`) para erros transitórios e saída inválida; sem retry para erros permanentes (401, 400, recusa do modelo).
- Jobs que esgotam as tentativas ficam no conjunto *failed* (`removeOnFail: false`), visíveis em `GET /admin/queues/failed`; a sugestão vira `FAILED`.
- **Idempotência:** id de job determinístico (`triage-<ticketId>`), `UNIQUE(ticketId)` + `upsert` e gravação condicional (`WHERE status = 'PENDING'`).
- Se o Redis estiver indisponível na publicação, o `POST` não falha; uma varredura agendada republica sugestões presas em `PENDING`.

## Alternativas consideradas

- **Chamar o LLM dentro da requisição:** simples, mas a latência do POST passaria a ser a do LLM (segundos) e cada falha dele viraria erro para o cliente.
- **Fire-and-forget em memória (`setImmediate`/promise sem await):** sem retry durável; um restart da API perde o trabalho.
- **Fila gerenciada (SQS, Pub/Sub) ou Kafka:** robustas, mas custo e complexidade desproporcionais para o projeto; Redis já cobre filas, agendamento e jobs falhos.

## Consequências

- ✅ `POST /tickets` responde em ~10 ms (mediana local); falhas do LLM ficam isoladas no worker.
- ✅ Retry, backoff e jobs falhos vêm prontos; o worker escala separado da API.
- ⚠️ Consistência eventual: a sugestão aparece segundos depois (status `PENDING` até lá).
- ⚠️ Mais uma dependência de infraestrutura (Redis) e mais um processo para operar.
- ⚠️ Publicação não é transacional com o banco; a varredura cobre a lacuna. O padrão *outbox* seria a solução completa.
