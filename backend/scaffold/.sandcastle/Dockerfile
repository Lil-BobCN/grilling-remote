# 固定 Sandcastle 版本，避免不同 Node 版本生成不同模板。
FROM node:26-bookworm

RUN npm install -g @ai-hero/sandcastle@0.12.0 \
  && npm install -g @anthropic-ai/claude-code

WORKDIR /workspace
