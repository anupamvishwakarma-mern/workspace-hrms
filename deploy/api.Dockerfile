# API and worker image. Build from the repository root:
#   docker build -f deploy/api.Dockerfile -t workforce-api .
# Run the API (default) or the worker:  docker run ... workforce-api node dist/worker.js
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
RUN pnpm install --frozen-lockfile --filter @workforce/api...
COPY apps/api apps/api
RUN pnpm --filter @workforce/api build \
 && pnpm --filter @workforce/api deploy --legacy --prod /out \
 && cp -r apps/api/dist /out/dist

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
# Only production dependencies and compiled output: no sources, tests, dev tools or lockfiles of other apps.
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
COPY --from=build /out/package.json ./package.json
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
