# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Production
FROM nginx:alpine AS production

COPY --from=builder /app/dist /usr/share/nginx/html
COPY --from=builder /app/dist/assets /usr/share/nginx/html/assets

# Custom nginx config for SPA
RUN echo 'server {     listen 80;     server_name localhost;     root /usr/share/nginx/html;     index index.html;     location / {         try_files $uri $uri/ /index.html;     }     location /assets {         expires 1y;         add_header Cache-Control "public, immutable";     }     gzip on;     gzip_types text/plain text/css application/json application/javascript text/xml application/xml; }' > /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries 3     CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1
