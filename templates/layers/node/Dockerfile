FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN __SPATIUS_CONTAINER_INSTALL__
RUN __SPATIUS_CONTAINER_BUILD__
FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 8787
CMD ["node", "node_modules/tsx/dist/cli.mjs", "server/index.ts"]
