# 客户成品的生产镜像。Mac 侧部署脚本构建 linux/amd64，传到源站 docker load。
FROM node:26-slim

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

USER 1000:1000
EXPOSE 3000
CMD ["node", "src/server.mjs"]
