# Web admin image. API_ORIGIN and STORAGE_ORIGIN are baked in at build time (Next evaluates rewrites and headers then):
#   docker build -f deploy/web.Dockerfile -t workforce-web \
#     --build-arg API_ORIGIN=http://api:4000 --build-arg STORAGE_ORIGIN=https://s3.example.com .
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
RUN pnpm install --frozen-lockfile --filter @workforce/web...
COPY apps/web apps/web
ARG API_ORIGIN=http://api:4000
ARG STORAGE_ORIGIN=
ENV API_ORIGIN=$API_ORIGIN STORAGE_ORIGIN=$STORAGE_ORIGIN NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @workforce/web build

FROM node:22-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY --from=build /repo /repo
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "@workforce/web", "start"]
