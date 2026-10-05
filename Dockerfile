FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Placeholders so route modules can load during the build; real values come from fly secrets.
RUN DATABASE_URL=postgres://build:build@localhost/build TELEGRAM_BOT_TOKEN=0:build DISABLE_SCHEDULER=1 npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "start"]
