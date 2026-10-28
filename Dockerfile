# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="Orbit" \
      org.opencontainers.image.source="https://github.com/PedroRBC/orbit" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.revision="$REVISION"
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
    ORBIT_HOST=0.0.0.0 PORT=3000 \
    ORBIT_DB_PATH=/data/orbit.db ORBIT_ENV_FILE=/config/orbit.env ORBIT_BACKUP_DIR=/backups
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json /app/next.config.ts /app/tsconfig.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/prompts ./prompts
COPY --from=build /app/public ./public
COPY --from=build /app/browser-extension ./browser-extension
# 568 é o usuário "apps" do TrueNAS; outro UID pode ser usado com `user:` no Compose.
RUN mkdir -p /data /backups /config && chown 568:568 /data /backups && chmod 700 /data /backups
USER 568:568
EXPOSE 3000
VOLUME ["/data", "/backups"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--import", "tsx", "scripts/dev.ts", "--production"]
