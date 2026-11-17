# 固定 Sandcastle 版本，避免不同 Node 版本生成不同模板。
FROM node:26-bookworm

# 客户仓的作业说明要求用 gh 读写工单；Debian 12 自带这个包。
RUN apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @ai-hero/sandcastle@0.12.0 \
  && npm install -g @anthropic-ai/claude-code

WORKDIR /workspace
