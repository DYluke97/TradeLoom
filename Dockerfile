FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3200
ENV HOSTNAME=0.0.0.0
RUN corepack enable

COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/skills ./skills
COPY --from=builder /app/samples ./samples
COPY --from=builder /app/next.config.ts ./next.config.ts

RUN mkdir -p /app/workspace
VOLUME ["/app/workspace"]
EXPOSE 3200

CMD ["node", "./node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3200"]
