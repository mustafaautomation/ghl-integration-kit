FROM node:20-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY config ./config
COPY keys ./keys
COPY fixtures ./fixtures
RUN npm ci
ARG NEXT_PUBLIC_API_BASE=http://localhost:4000
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
RUN npm run build -w @ghl/console

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production

FROM runtime AS mock
EXPOSE 4100
CMD ["npm", "run", "start:mock"]

FROM runtime AS api
EXPOSE 4000
CMD ["npm", "run", "start:api"]

FROM runtime AS console
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@ghl/console"]
