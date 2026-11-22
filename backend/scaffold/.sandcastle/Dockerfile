# 固定 Sandcastle 版本，避免不同 Node 版本生成不同模板。
FROM node:26-bookworm

# 客户仓的作业说明要求用 gh 读写工单；Debian 12 自带这个包。
RUN apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @ai-hero/sandcastle@0.12.0 \
  && npm install -g @anthropic-ai/claude-code

# 下面是 Sandcastle 0.12.0 的镜像约定，改模板时保留：
# 声明两个 build-arg，构建时传宿主 UID/GID；
# 把基础镜像的 node 用户改名为 agent，UID/GID 和宿主一致。
# 容器以 --user 宿主 UID:GID 启动，HOME 指向 /home/agent，这个目录必须可写。
ARG AGENT_UID=1000
ARG AGENT_GID=1000

RUN groupmod -o -g $AGENT_GID node && usermod -o -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node
USER ${AGENT_UID}:${AGENT_GID}

WORKDIR /home/agent

# Sandcastle 用 docker run -d 不带命令起容器：镜像默认入口必须常驻，否则容器立即退出。
ENTRYPOINT ["sleep", "infinity"]
