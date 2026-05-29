FROM node:20-slim

RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libjpeg-dev \
    libpango1.0-dev \
    libgif-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

# --max-old-space-size=400 keeps OOM a clean fast restart on the 512MB instance
# (bounds the memory-exhaustion DoS surface alongside the in-app Map ceilings).
CMD ["node", "--max-old-space-size=400", "bot.js"]
