# Immagine Playwright ufficiale: Node + Chromium + tutte le dipendenze di sistema già dentro.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# dipendenze (solo playwright-core) — sfrutta la cache se package*.json non cambia
COPY package*.json ./
RUN npm ci --omit=dev

# codice
COPY . .

# in container usa il Chromium bundled dell'immagine (non il "channel chrome")
ENV PW_CHANNEL=""
ENV NODE_ENV=production

# Railway inietta PORT a runtime; il server fa già fallback a 4040
EXPOSE 4040
CMD ["node", "server.mjs"]
