# Use the official Node.js 20 lightweight alpine image
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy tsconfig and source files
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript
RUN npm run build

# Stage 2: Run the built application
FROM node:20-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --only=production

# Copy built code from builder stage
COPY --from=builder /usr/src/app/dist ./dist

# Expose port (Cloud Run defaults to 8080)
EXPOSE 8080

CMD ["node", "dist/index.js"]
