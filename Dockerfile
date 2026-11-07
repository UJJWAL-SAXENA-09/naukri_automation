FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    BROWSER_EXECUTABLE_PATH=/usr/bin/chromium \
    CONTAINERIZED_BROWSER=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium xvfb x11vnc novnc websockify gosu ca-certificates fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 automation \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin automation

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . ./
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint
RUN chmod 755 /usr/local/bin/docker-entrypoint \
    && mkdir -p /state \
    && chown automation:automation /state

ENTRYPOINT ["/usr/local/bin/docker-entrypoint"]
CMD ["scheduler"]
