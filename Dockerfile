# WaxPrep AI Tutor - Production Dockerfile for Render
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install system dependencies for Node.js and Python
RUN apk add --no-cache \
    python3 \
    py3-pip \
    gcc \
    g++ \
    make \
    libc-dev \
    linux-headers \
    bash \
    curl

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["npm", "start"]
