FROM node:24-bookworm-slim AS build
WORKDIR /app
ARG API_URL=http://api:4018
ENV API_URL=$API_URL
COPY . .
RUN npm ci && npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS api
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=4018
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 4018
CMD ["node","dist/apps/api/src/main.js"]

FROM node:24-bookworm-slim AS web
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/web ./apps/web
USER node
EXPOSE 3018
CMD ["node","node_modules/next/dist/bin/next","start","apps/web","--hostname","0.0.0.0","-p","3018"]
