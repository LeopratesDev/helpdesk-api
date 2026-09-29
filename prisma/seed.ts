/**
 * Seed de demonstração: usuários dos 3 papéis, 6 categorias e 50 chamados.
 * É determinístico (PRNG com semente fixa) e pode ser rodado várias vezes:
 * apaga os dados antes de inserir.
 */
import { Prisma, PrismaClient, Priority, Role, TicketStatus } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { computeSlaDueAt } from '../src/sla/sla.policy';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Demo@123';
const HOUR = 3_600_000;

// PRNG simples (mulberry32): dados reproduzíveis sem dependência extra
function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(42);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)] as T;

const SAMPLES: Record<string, string[]> = {
  'Acesso e login': [
    'Não consigo fazer login',
    'Senha expirada',
    'Conta bloqueada após tentativas',
  ],
  Financeiro: [
    'Boleto com valor errado',
    'Cobrança duplicada no cartão',
    'Nota fiscal não emitida',
  ],
  'Bug no sistema': [
    'Erro 500 ao salvar pedido',
    'Relatório exporta planilha vazia',
    'Tela trava ao anexar arquivo',
  ],
  'Dúvida de uso': [
    'Como cadastrar um novo usuário?',
    'Onde vejo o histórico de pedidos?',
    'Como alterar meu plano?',
  ],
  Integração: [
    'Webhook não está disparando',
    'API retorna 401 com token válido',
    'Sincronização com ERP parada',
  ],
  Hardware: [
    'Impressora fiscal não imprime',
    'Leitor de código de barras sem resposta',
    'Notebook não liga',
  ],
};

const PRIORITIES: Priority[] = ['BAIXA', 'MEDIA', 'MEDIA', 'ALTA', 'ALTA', 'CRITICA'];

// Sequência de transições válidas até cada status final (gera histórico coerente)
const PATH_TO: Record<TicketStatus, TicketStatus[]> = {
  ABERTO: ['ABERTO'],
  EM_ATENDIMENTO: ['ABERTO', 'EM_ATENDIMENTO'],
  AGUARDANDO_CLIENTE: ['ABERTO', 'EM_ATENDIMENTO', 'AGUARDANDO_CLIENTE'],
  RESOLVIDO: ['ABERTO', 'EM_ATENDIMENTO', 'RESOLVIDO'],
  FECHADO: ['ABERTO', 'EM_ATENDIMENTO', 'RESOLVIDO', 'FECHADO'],
};
const STATUSES = Object.keys(PATH_TO) as TicketStatus[];

async function main(): Promise<void> {
  // Ordem respeita as FKs; tudo numa transação
  await prisma.$transaction([
    prisma.triageSuggestion.deleteMany(),
    prisma.ticketHistory.deleteMany(),
    prisma.comment.deleteMany(),
    prisma.ticket.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.category.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  const passwordHash = await hash(DEMO_PASSWORD);
  const mk = (name: string, email: string, role: Role) =>
    prisma.user.create({ data: { name, email, role, passwordHash } });

  await mk('Admin Demo', 'admin@helpdesk.dev', 'ADMIN');
  const agents = [
    await mk('Atendente Demo', 'atendente@helpdesk.dev', 'ATENDENTE'),
    await mk('Bruna Atendente', 'bruna@helpdesk.dev', 'ATENDENTE'),
  ];
  const clients = [
    await mk('Cliente Demo', 'cliente@helpdesk.dev', 'CLIENTE'),
    await mk('Carlos Cliente', 'carlos@helpdesk.dev', 'CLIENTE'),
    await mk('Daniela Cliente', 'daniela@helpdesk.dev', 'CLIENTE'),
  ];
  const categories = await Promise.all(
    Object.keys(SAMPLES).map((name) => prisma.category.create({ data: { name } })),
  );

  const now = Date.now();
  for (let i = 0; i < 50; i++) {
    const category = pick(categories);
    const samples = SAMPLES[category.name] ?? [];
    const priority = pick(PRIORITIES);
    const status = pick(STATUSES);
    const requester = pick(clients);
    const createdAt = new Date(now - Math.floor(rand() * 30 * 24) * HOUR);
    const slaDueAt = computeSlaDueAt(priority, createdAt);
    const path = PATH_TO[status];

    const data: Prisma.TicketCreateInput = {
      title: pick(samples),
      description: `${pick(samples)}. Chamado de demonstração nº ${i + 1}.`,
      priority,
      status,
      slaDueAt,
      createdAt,
      category: { connect: { id: category.id } },
      requester: { connect: { id: requester.id } },
      slaBreached: status === 'ABERTO' && slaDueAt.getTime() < now,
    };
    const history: Prisma.TicketHistoryCreateWithoutTicketInput[] = [
      { field: 'status', newValue: 'ABERTO', createdAt, actor: { connect: { id: requester.id } } },
    ];

    if (status !== 'ABERTO') {
      const agent = pick(agents);
      // Primeira resposta entre 0,5h e 1,5x o prazo → parte dos chamados estoura o SLA
      const slaMs = slaDueAt.getTime() - createdAt.getTime();
      const firstResponseAt = new Date(createdAt.getTime() + HOUR / 2 + rand() * slaMs * 1.5);
      let t = firstResponseAt.getTime();
      for (let s = 1; s < path.length; s++) {
        history.push({
          field: 'status',
          oldValue: path[s - 1],
          newValue: path[s],
          createdAt: new Date(t),
          actor: { connect: { id: agent.id } },
        });
        if (path[s] === 'RESOLVIDO') data.resolvedAt = new Date(t);
        if (path[s] === 'FECHADO') data.closedAt = new Date(t);
        t += (2 + rand() * 24) * HOUR;
      }
      Object.assign(data, {
        assignee: { connect: { id: agent.id } },
        firstResponseAt,
        slaBreached: firstResponseAt > slaDueAt,
        comments: {
          create: [
            {
              body: 'Olá! Recebemos seu chamado e já estamos analisando.',
              authorId: agent.id,
              createdAt: firstResponseAt,
            },
            {
              body: 'Verificar logs do cliente antes de responder.',
              internal: true,
              authorId: agent.id,
              createdAt: firstResponseAt,
            },
          ],
        },
      });
    }

    // Sugestão da IA: abertos aguardam decisão; os demais foram aceitos (~75%) ou corrigidos
    const decided = status !== 'ABERTO';
    const accepted = decided && rand() < 0.75;
    const suggestedPriority =
      decided && !accepted ? pick(PRIORITIES.filter((p) => p !== priority)) : priority;
    data.triage = {
      create: {
        status: !decided ? 'SUGGESTED' : accepted ? 'ACCEPTED' : 'CORRECTED',
        suggestedCategory: category.name,
        suggestedPriority,
        summary: data.title,
        confidence: Math.round((0.5 + rand() * 0.5) * 100) / 100,
        inputText: `${data.title}\n\n${data.description}`,
        model: 'fake',
        attempts: 1,
        finalCategory: decided ? category.name : null,
        finalPriority: decided ? priority : null,
        decidedAt: decided ? data.firstResponseAt : null,
      },
    };

    await prisma.ticket.create({ data: { ...data, history: { create: history } } });
  }

  const [users, tickets] = await Promise.all([prisma.user.count(), prisma.ticket.count()]);
  console.log(
    `Seed concluído: ${users} usuários, ${categories.length} categorias, ${tickets} chamados.`,
  );
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
