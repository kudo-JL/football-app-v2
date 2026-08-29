# syntax=docker/dockerfile:1.7
# ---- Build stage ----
FROM node:22-bookworm-slim AS build
WORKDIR /build

# Install only production deps
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# ---- Runtime stage ----
FROM node:22-bookworm-slim
WORKDIR /app

# Required for sharp / native modules (future-proof)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Bring in node_modules from the build stage
COPY --from=build /build/node_modules ./node_modules

# Copy the rest of the application
COPY . .

# Make sure data and upload directories exist
RUN mkdir -p /app/data /app/public/uploads/teams

# Persistent volume is mounted at /app/data
# (Configured in fly.toml with [[mounts]])

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:3000/health || exit 1

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Use exec form so signals (SIGTERM) are forwarded properly
CMD ["node", "server.js"]
