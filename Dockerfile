FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Runs as root in Docker — no sudo/su issues
RUN npx playwright install --with-deps chromium

COPY . .

# Next.js inlines NEXT_PUBLIC_* at build time, so they must be available here
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
