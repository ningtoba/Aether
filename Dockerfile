# =============================================================================
# Aether — single image: backend (Bun + embedded omp engine) + web GUI.
#
# `docker compose up` → visit http://localhost:3081 (host port remapped;
# the container stays on internal 3001/3002 per REALTIME_PORT).
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: build — Node image (has npm) for lockfile-faithful dep install +
# tsc + vite build; artifacts are copied into the Bun runtime image.
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Root + workspace manifests for layer-cached dependency resolution.
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/aether-core/package.json packages/aether-core/package.json
COPY packages/aether-backend/package.json packages/aether-backend/package.json
COPY packages/aether-frontend/package.json packages/aether-frontend/package.json

RUN npm ci --no-audit --no-fund

COPY packages/ packages/

# Build all TypeScript packages (tsc -b --force), then the frontend bundle.
RUN npm run build && npm run build:frontend

# -----------------------------------------------------------------------------
# Stage 2: runtime — Bun runtime + compiled output, no toolchain.
# The embedded omp SDK runs only under Bun.
# -----------------------------------------------------------------------------
FROM oven/bun:1.3.14 AS runtime
WORKDIR /app

# dumb-init for clean signal handling (PID 1) + curl for the healthcheck.
RUN apt-get update -qq && apt-get install -yqq dumb-init curl && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/packages ./packages
COPY --from=build /app/node_modules ./node_modules

# Envvars — the backend reads these.
ENV NODE_ENV=production
ENV PORT=3001
ENV REALTIME_PORT=3002
ENV HOST=0.0.0.0
# Container must bind all interfaces for -p publishing; compose publishes 127.0.0.1-only (see docker-compose.yml ports).
ENV AETHER_ALLOW_UNAUTHENTICATED=1

EXPOSE 3001 3002

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl --fail --silent http://127.0.0.1:3001/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
# Run the COMPILED, type-checked artifact: `npm run build` (tsc -b --force) ran
# in the build stage and CI type-checks the same emit, so what ships is what
# was verified. Running src/main.ts under Bun made build and runtime silently
# drift (Bun would happily execute TS that tsc rejected). dist/ is already in
# the image (COPY -from=build /app/packages copies the built tree) and every
# module-relative path resolves identically from dist/: static-server.ts's
# resolveFrontendDist() candidate 1 hits packages/aether-frontend/dist from
# either src/static/ or dist/static/ (same dir depth), and main.ts reads
# ../package.json for its version.
CMD ["bun", "run", "packages/aether-backend/dist/main.js"]
