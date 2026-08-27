FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app \
 && mkdir -p /app/uploads && chown -R app:app /app
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
USER app
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:5000/health || exit 1
CMD ["node", "src/index.js"]
