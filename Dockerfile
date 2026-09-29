# syntax=docker/dockerfile:1

# ---------- deps: todas as dependências + código (usado também pelo serviço "migrate", que roda o seed) ----------
FROM node:24-bookworm-slim AS deps
# OpenSSL é exigido pelo engine do Prisma
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src

# ---------- build: compila o TypeScript e remove as devDependencies ----------
FROM deps AS build
RUN npm run build && npm prune --omit=dev

# ---------- runtime: só o necessário para rodar (sem devDependencies nem código-fonte) ----------
FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
# Não roda como root
USER node
EXPOSE 3000
# Mesma imagem para API e worker; o compose troca o comando do worker
CMD ["node", "dist/main.js"]
