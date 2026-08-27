FROM node:20-alpine AS build
WORKDIR /app
ARG VITE_API_BASE=/api
ARG VITE_SOCKET_URL=
ENV VITE_API_BASE=$VITE_API_BASE
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
