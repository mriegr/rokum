FROM oven/bun:1.3.14

WORKDIR /app

COPY package.json bun.lock tsconfig.json index.ts ./
COPY src ./src
COPY ["urbansportsclub-venues-with-addresses co.json", "./urbansportsclub-venues-with-addresses.json"]

RUN bun install --frozen-lockfile --production \
  && chown -R bun:bun /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data

VOLUME ["/data"]

EXPOSE 3000

USER bun

CMD ["bun", "index.ts"]
