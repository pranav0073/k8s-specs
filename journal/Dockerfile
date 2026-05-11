# Stage 1: build React frontend
FROM node:20-alpine AS frontend
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: production image
FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
COPY --from=frontend /app/build ./public

# SQLite data lives on a mounted volume at /data
ENV DB_PATH=/data/journal.db
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
