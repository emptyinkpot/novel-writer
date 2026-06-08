FROM node:20-slim AS build

WORKDIR /build
ENV npm_config_registry=https://registry.npmmirror.com
RUN npm install -g pnpm@10.33.0 --registry=https://registry.npmmirror.com \
  && pnpm config set registry https://registry.npmmirror.com

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN pnpm install --frozen-lockfile

COPY apps/api ./apps/api
COPY apps/web ./apps/web
COPY packages/shared ./packages/shared

RUN pnpm --filter @guga-write/api build
RUN pnpm --filter @guga-write/web build

FROM node:20-slim

ENV NODE_ENV=production
ENV PORT=19201
ENV WEB_PORT=19200
ENV INTERNAL_API_URL=http://127.0.0.1:19201

WORKDIR /app
ENV npm_config_registry=https://registry.npmmirror.com
RUN npm install -g pnpm@10.33.0 --registry=https://registry.npmmirror.com \
  && pnpm config set registry https://registry.npmmirror.com

COPY --from=build /build/package.json /build/pnpm-lock.yaml /build/pnpm-workspace.yaml ./
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/apps/api ./apps/api
COPY --from=build /build/apps/web ./apps/web
COPY --from=build /build/packages ./packages

EXPOSE 19200

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:19200/api/v1/health').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

CMD ["sh", "-c", "node apps/api/dist/main.js & pnpm --dir apps/web start"]
