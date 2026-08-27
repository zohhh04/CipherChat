# Deployment Guide

## 1. Docker Compose (single host)

```bash
export JWT_ACCESS_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
export JWT_REFRESH_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
export CLIENT_URLS=https://chat.example.com
export APP_PORT=8080

docker compose up -d --build

# bootstrap admin
docker compose exec -e ADMIN_EMAIL=admin@example.com -e ADMIN_PASSWORD='<strong>' \
  -e MONGO_URI=mongodb://mongo:27017/securechat server node scripts/createAdmin.js
```

Compose topology: `client` (nginx :80) → proxies `/api/*` and `/socket.io/*`
(websocket upgrade configured) → `server` → `mongo`. Only the client port is published.

## 2. TLS

The nginx container serves plain HTTP on 8080 — terminate TLS at your edge:

* **Recommended:** Caddy, Traefik, cloud LB, or host nginx with certbot:

```nginx
server {
  listen 443 ssl http2;
  server_name chat.example.com;
  ssl_certificate     /etc/letsencrypt/live/chat.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;      # websocket support
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

Then set:
* `COOKIE_SECURE=true`, `CLIENT_URLS=https://chat.example.com`, `APP_PUBLIC_URL=https://chat.example.com`
* SMTP credentials so verification/reset emails actually deliver.

Direct-TLS alternative: set `ENABLE_HTTPS=true` with `TLS_KEY_PATH`/`TLS_CERT_PATH` and
publish the server port directly (HSTS is emitted by Helmet).

## 3. Kubernetes / containers notes

* Server needs one RW volume for encrypted upload blobs (`file_uploads`) or mount an S3-backed volume; scale horizontally only with sticky sessions OR swap in
  `@socket.io/redis-adapter` (single code change in `src/sockets/index.js`).
* Health checks: `/api/health` (server), `GET /` (client).
* Run containers as non-root (already configured) and pin image digests.

## 4. Hardening checklist (production)

- [ ] Unique 48-byte JWT secrets; rotate periodically (refresh rotation revokes stolen sessions automatically)
- [ ] `COOKIE_SECURE=true` behind HTTPS only
- [ ] SMTP configured; `EMAIL_VERIFICATION_REQUIRED=true`
- [ ] Mongo auth enabled + network-isolated (compose network already internal)
- [ ] Backups: `mongodump` schedule + upload volume snapshot
- [ ] Log shipping for pino JSON output; alert on `severity=critical` audit events (`auth.refresh.reuse_detected`, bans)
- [ ] TURN server (coturn) for reliable calls behind symmetric NAT
- [ ] Set `LOG_PRETTY=false`

## 5. Scaling notes

| Bottleneck | Mitigation |
| --- | --- |
| Socket.IO fan-out | Redis adapter + multiple server replicas behind LB w/ sticky sessions |
| Message history | MongoDB indexes exist (`chat+createdAt`); add TTL/archival policy if unbounded |
| Uploads | Move disk storage to S3-compatible storage with signed URLs (keep membership gate server-side) |
| Rate limits | Swap in-memory stores for `rate-limit-redis` when running replicas |

## 6. CI/CD

`.github/workflows/ci.yml` runs on push/PR:
1. `server-test` — installs, runs Jest suite against mongodb-memory-server.
2. `client-build` — Vite production build.
3. `docker-build` — builds both images.

Extend it with your registry push + deploy hook (e.g., `docker/build-push-action` then SSH/Webhook deploy) once you have infrastructure targets.
