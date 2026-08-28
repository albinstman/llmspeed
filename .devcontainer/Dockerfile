FROM mcr.microsoft.com/devcontainers/base:ubuntu

# basics
RUN apt-get update && apt-get upgrade -y && apt-get install -y \
    curl \
    ca-certificates \
    wget \
    git \
    jq \
    unzip \
    vim \
    less \
    tree \
    ripgrep \
    fd-find \
    htop \
    zsh \
    fzf \
    net-tools \
    dnsutils \
    iputils-ping \
    tar \
    openssh-client \
    python3 \
    python3-pip \
    make \
    g++ \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Persist bash history across container rebuilds
RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
    && mkdir -p /commandhistory \
    && touch /commandhistory/.bash_history \
    && echo "$SNIPPET" >> /root/.bashrc

# Node.js 22 LTS (official binaries)
ARG NODE_VERSION=22.14.0
RUN ARCH=$(dpkg --print-architecture) \
    && case "$ARCH" in amd64) NODE_ARCH=x64 ;; arm64) NODE_ARCH=arm64 ;; *) echo "unsupported arch: $ARCH" && exit 1 ;; esac \
    && apt-get update && apt-get install -y xz-utils && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" -o /tmp/node.tar.xz \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz \
    && node --version && npm --version

# Playwright browsers (headless Chromium + WebKit/Safari engine) with their system deps,
# used for headless UI testing of the site. Version pinned to match package.json.
RUN npx -y playwright@1.62.1 install --with-deps chromium-headless-shell webkit \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*
