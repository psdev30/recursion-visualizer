FROM node:20-slim

WORKDIR /app

# Install dependencies for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application files
COPY . .

# Create db directory
RUN mkdir -p /app/db

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]
