FROM node:20-alpine

# Install pnpm
RUN npm install -g pnpm@8

WORKDIR /workspace

# Copy workspace files first
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./

# Copy proto package
COPY proto/ ./proto/

# Copy this service
COPY services/ofa-gateway/ ./services/ofa-gateway/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Build workspace
RUN pnpm build

# Set working directory to service
WORKDIR /workspace/services/ofa-gateway

# Expose ports
EXPOSE 3000 3001

# Run the application
CMD ["node", "dist/index.js"]