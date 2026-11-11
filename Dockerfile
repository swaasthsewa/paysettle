# PaySettle as a container.
#   docker build -t paysettle-web .               the web server (the last stage)
#   docker build -t paysettle-ops --target ops .  database jobs: schema push and the demo seed
# The server listens on $PORT (8080 unless set) and needs DATABASE_URL at run time.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder
COPY . .
# webpack, not Turbopack: Turbopack runs past 8 GiB on the Bryntum trial's 6 MB obfuscated gantt.module.js, while
# webpack builds it in about 2 GiB. Two build workers and a 3 GiB heap keep the whole build well under 8 GiB.
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone NEXT_BUILD_CPUS=2 NODE_OPTIONS=--max-old-space-size=3072
RUN npx next build --webpack

# Database jobs. Full dependencies and the source, no build: `npm run db:push` (the default), `npm run db:seed`.
FROM deps AS ops
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
USER node
CMD ["npm", "run", "db:push"]

# The web server: only what the build traced as needed.
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# evidence files are stored under /app/uploads (src/server/evidence/storage.ts); /app belongs to root, so the folder is
# created here and handed to the user the server runs as, or every evidence upload fails with EACCES
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 8080
CMD ["node", "server.js"]
