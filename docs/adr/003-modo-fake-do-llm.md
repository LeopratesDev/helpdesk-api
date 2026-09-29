# ADR 003 — Modo fake do LLM

- **Status:** aceita
- **Data:** 2026-09-29

## Contexto

A triagem usa a API da Anthropic, que é paga e exige chave. Este é um projeto de portfólio: recrutadores e avaliadores precisam conseguir rodar tudo com `docker compose up`, sem criar conta nem gastar. Os testes também não podem depender de rede, de uma chave nem de respostas não determinísticas. E nenhuma chave pode ir para o repositório.

## Decisão

O worker depende de uma interface, `LlmClient`, e um *provider factory* do NestJS escolhe a implementação na inicialização:

- `ANTHROPIC_API_KEY` definida → `AnthropicLlmClient` (SDK oficial, modelo em `LLM_MODEL`).
- Ausente ou vazia → `FakeLlmClient`: regras locais por palavra-chave, **determinísticas**, sem rede e sem custo. O log avisa `triagem em MODO FAKE`.
- Nos testes, uma terceira implementação (mock controlado pelo teste) é injetada com `overrideProvider(LLM_CLIENT)`. O cliente real é testado com o SDK simulado.

As três passam pelo mesmo caminho: timeout, validação Zod, retry e gravação idempotente. Só muda quem gera o JSON.

A chave só existe no ambiente (`.env`, que está no `.gitignore`, ou variável do host no Docker Compose). O `.env.example` deixa o campo vazio.

## Alternativas consideradas

- **Exigir a chave sempre:** barra quem só quer avaliar o projeto e deixa os testes caros e frágeis.
- **Desligar a triagem sem chave:** o fluxo principal (fila → worker → sugestão → aceitar/corrigir) não poderia ser visto.
- **Gravar respostas reais e reproduzi-las (fixtures):** mais realista, mas precisaria de uma chave para gerar e de manutenção a cada mudança de prompt.

## Consequências

- ✅ Qualquer pessoa roda o projeto completo de graça; testes rápidos, determinísticos e offline.
- ✅ Trocar de provedor de LLM exige só uma nova implementação de `LlmClient`.
- ⚠️ A qualidade da triagem em modo fake é baixa (palavras-chave); não serve para avaliar a IA.
- ⚠️ O caminho real depende de testes com o SDK simulado; uma mudança na API da Anthropic só apareceria rodando com chave. Um teste manual com chave é recomendado antes de um deploy.
