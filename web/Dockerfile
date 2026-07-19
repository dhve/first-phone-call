FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_HOST39_API_URL
ENV NEXT_PUBLIC_HOST39_API_URL=$NEXT_PUBLIC_HOST39_API_URL
ARG NEXT_PUBLIC_HOST39_CARDS_URL
ENV NEXT_PUBLIC_HOST39_CARDS_URL=$NEXT_PUBLIC_HOST39_CARDS_URL
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3002
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3002
CMD ["node", "server.js"]
