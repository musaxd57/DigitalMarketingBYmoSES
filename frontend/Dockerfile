FROM node:20-alpine AS base

RUN apk update && apk upgrade && apk add --no-cache dumb-init

WORKDIR /app

# ─── Dependencies ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY package*.json ./
RUN npm ci && npm cache clean --force

# ─── Build ────────────────────────────────────────────────────────────────────
FROM deps AS builder
COPY . .
ARG VITE_API_URL=http://localhost:3001
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ─── Production: serve with nginx ─────────────────────────────────────────────
FROM nginx:alpine AS production

# Copy build output
COPY --from=builder /app/dist /usr/share/nginx/html

# Nginx config for SPA routing
RUN cat > /etc/nginx/conf.d/default.conf << 'EOF'
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # Enable gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
    gzip_min_length 1000;

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
        add_header X-Frame-Options "SAMEORIGIN";
        add_header X-Content-Type-Options "nosniff";
    }
}
EOF

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]

# ─── Development: run vite dev server ─────────────────────────────────────────
FROM deps AS development

COPY . .

EXPOSE 3000
ENV NODE_ENV=development

CMD ["dumb-init", "npm", "run", "dev", "--", "--host", "0.0.0.0"]
