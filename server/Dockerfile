# REQUIRED BUILD CONTEXT: the repo root (not server/).
# The monorepo keeps a single npm-workspaces package-lock.json at the root,
# so npm ci needs the root manifests plus every workspace manifest:
#   docker build -f server/Dockerfile .
# (docker-compose.yml and docker-compose.prod.yml set context: . accordingly)

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
COPY mobile/package.json ./mobile/
COPY packages/react-native-device-agent/package.json ./packages/react-native-device-agent/
RUN npm ci --workspace server
COPY server/tsconfig.json server/tsconfig.build.json ./server/
COPY server/src ./server/src
RUN npm run build --workspace server

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
COPY mobile/package.json ./mobile/
COPY packages/react-native-device-agent/package.json ./packages/react-native-device-agent/
RUN npm ci --omit=dev --workspace server
COPY --from=builder /app/server/dist ./server/dist
COPY server/src/db/migrations ./server/db/migrations
COPY server/entrypoint.sh ./server/
RUN chmod +x server/entrypoint.sh
WORKDIR /app/server
EXPOSE 3010
ENTRYPOINT ["./entrypoint.sh"]
