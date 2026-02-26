FROM champdsdevops/node:22.22-alpine

WORKDIR /app

RUN apk add --no-cache ffmpeg

# Copy package files
COPY backend/package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY backend/src/ ./src/

# Expose the server port (will be overridden by compose)
EXPOSE 7011

# Start the application
CMD ["node", "src/index.js"]
