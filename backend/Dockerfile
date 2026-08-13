# Stage 1: Dependencies
FROM node:20-alpine AS dependencies
WORKDIR /app
RUN apk add --no-cache python3 make g++ openssl
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --only=production --ignore-scripts && npm cache clean --force
# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++ openssl
COPY package*.json ./
COPY tsconfig.json ./
COPY nest-cli.json ./
COPY prisma ./prisma/
COPY src ./src/
RUN npm ci && npm run db:generate && npm run build

# Stage 3: Production
FROM node:20-alpine AS production
WORKDIR /app
RUN apk add --no-cache dumb-init
RUN addgroup -g 1001 -S nodejs && adduser -S muscleos -u 1001
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
RUN chown -R muscleos:nodejs /app
USER muscleos
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD node -e "require('http').get('http://localhost:3000/api/v1/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
