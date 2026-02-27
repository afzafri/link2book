FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Runs as root in Docker — no sudo/su issues
RUN npx playwright install --with-deps chromium

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
