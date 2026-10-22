FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN BETTER_AUTH_SECRET=build-only-not-a-runtime-secret-replace-me DATA_DIR=/tmp/build-data npm run build
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 DATA_DIR=/app/data
RUN groupadd --system --gid 1001 tongye && useradd --system --uid 1001 --gid 1001 tongye
COPY --from=build --chown=tongye:tongye /app/.next/standalone ./
COPY --from=build --chown=tongye:tongye /app/.next/static ./.next/static
COPY --from=build --chown=tongye:tongye /app/public ./public
COPY --from=build --chown=tongye:tongye /app/node_modules ./node_modules
COPY --from=build --chown=tongye:tongye /app/src ./src
COPY --from=build --chown=tongye:tongye /app/scripts ./scripts
COPY --from=build --chown=tongye:tongye /app/migrations ./migrations
COPY --from=build --chown=tongye:tongye /app/tsconfig.json /app/package.json ./
RUN mkdir -p /app/data /app/backups && chown -R tongye:tongye /app/data /app/backups
USER tongye
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
