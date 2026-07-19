# REQUIRED BUILD CONTEXT: the repo root (not web/).
# The monorepo keeps a single npm-workspaces package-lock.json at the root,
# so npm ci needs the root manifests plus every workspace manifest:
#   docker build -f web/Dockerfile .
# (docker-compose.yml and docker-compose.prod.yml set context: . accordingly)

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
COPY mobile/package.json ./mobile/
COPY packages/react-native-device-agent/package.json ./packages/react-native-device-agent/
RUN npm ci --workspace web
COPY web ./web
ARG NEXT_PUBLIC_HOST39_API_URL
ENV NEXT_PUBLIC_HOST39_API_URL=$NEXT_PUBLIC_HOST39_API_URL
ARG NEXT_PUBLIC_HOST39_CARDS_URL
ENV NEXT_PUBLIC_HOST39_CARDS_URL=$NEXT_PUBLIC_HOST39_CARDS_URL
RUN npm run build --workspace web

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3002
ENV HOSTNAME=0.0.0.0
# Next.js standalone output mirrors the monorepo layout: the app's server.js
# lands under web/ and shared node_modules land at the root.
COPY --from=builder /app/web/.next/standalone ./
COPY --from=builder /app/web/.next/static ./web/.next/static
COPY --from=builder /app/web/public ./web/public
EXPOSE 3002
CMD ["node", "web/server.js"]
