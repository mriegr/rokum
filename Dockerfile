FROM oven/bun:1.3.14

WORKDIR /app

COPY package.json bun.lock tsconfig.json index.ts index.html ./
COPY src ./src
COPY urbansportsclub-venues-with-addresses.json ./urbansportsclub-venues-with-addresses.json

RUN bun install --frozen-lockfile

ENV PORT=3000
ENV DATA_DIR=/data

VOLUME ["/data"]

EXPOSE 3000

CMD ["bun", "index.ts"]
