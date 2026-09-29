# ADR 002 — Prisma como ORM

- **Status:** aceita
- **Data:** 2026-09-29

## Contexto

O projeto usa PostgreSQL e precisa de: migrations versionadas, tipos seguros em TypeScript `strict`, índices nos campos de filtro e transações (por exemplo, mudar o status e gravar o histórico juntos). A arquitetura precisa ser simples de explicar e manter por uma pessoa desenvolvedora júnior.

## Decisão

Usar **Prisma**:

- `prisma/schema.prisma` é a fonte da verdade; `prisma migrate dev` gera migrations SQL versionadas no Git e `migrate deploy` as aplica em outros ambientes.
- O Prisma Client gerado dá tipos a partir do schema: mudar uma coluna quebra a compilação onde ela é usada.
- Transações interativas (`$transaction(async tx => ...)`) para operações que precisam acontecer juntas.
- **SQL escrito à mão onde o Prisma não alcança**, via `$queryRaw` com parâmetros: o job de SLA (`UPDATE ... RETURNING` + `INSERT` num único comando, atômico e idempotente) e as agregações de métricas (`AVG`, `COUNT FILTER`).

## Alternativas consideradas

- **TypeORM:** integração tradicional com NestJS, mas tipos menos precisos (entidades com decorators podem divergir do banco) e histórico de problemas com migrations geradas.
- **Drizzle / Kysely:** ótimos tipos e mais próximos do SQL, mas ecossistema menor e mais código para operações comuns.
- **SQL puro (`pg`):** controle total, porém sem tipos automáticos nem migrations; muito código repetitivo.

## Consequências

- ✅ Produtividade e segurança de tipos; migrations revisáveis em PR.
- ✅ Mesmo modelo mental que EF Core, usado no projeto anterior (RH Manager).
- ⚠️ Engine binário do Prisma aumenta a imagem Docker (~180 MB) e exige OpenSSL.
- ⚠️ Algumas consultas (UPDATE em lote com retorno, agregações) exigem SQL manual; mantidas poucas e comentadas.
- ⚠️ Migrations são imutáveis depois de aplicadas: toda mudança de schema é uma migration nova.
