# =============================================================================
# Stage 1: Builder — full Node.js image for dependency install & TypeScript build
# =============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root manifests
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./

# Copy workspace package manifests (for dependency resolution)
COPY packages/aether-backend/package.json packages/aether-backend/package.json
COPY packages/aether-core/package.json packages/aether-core/package.json
COPY packages/aether-types/package.json packages/aether-types/package.json
COPY packages/aether-utils/package.json packages/aether-utils/package.json
COPY packages/aether-memory/package.json packages/aether-memory/package.json
COPY packages/aether-orchestrator/package.json packages/aether-orchestrator/package.json
COPY packages/aether-providers/package.json packages/aether-providers/package.json
COPY packages/aether-sdk/package.json packages/aether-sdk/package.json
COPY packages/aether-security/package.json packages/aether-security/package.json
COPY packages/aether-telemetry/package.json packages/aether-telemetry/package.json
COPY packages/aether-tools/package.json packages/aether-tools/package.json
COPY packages/docker/package.json packages/docker/package.json
COPY packages/playwright/package.json packages/playwright/package.json
COPY packages/python-venv/package.json packages/python-venv/package.json
COPY packages/ts-runtime/package.json packages/ts-runtime/package.json

# Install ALL dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY packages/ packages/

# Build all packages via project references
RUN npm run build

# Prune devDependencies — keep only production deps
RUN npm prune --omit=dev

# =============================================================================
# Stage 2: Runtime — minimal Node.js Alpine image
# =============================================================================
FROM node:22-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Copy built artifacts and production node_modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Expose backend server port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the backend server
CMD ["node", "packages/aether-backend/dist/index.js"]
