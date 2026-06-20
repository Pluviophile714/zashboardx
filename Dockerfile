FROM --platform=$BUILDPLATFORM docker.io/guergeiro/pnpm:lts-latest AS builder

WORKDIR /build

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm run build

FROM docker.io/caddy:alpine

EXPOSE 80

WORKDIR /srv

COPY --from=builder /build/dist/. .
COPY Caddyfile .
RUN find /srv -type f \( \
  -name '*.css' -o \
  -name '*.html' -o \
  -name '*.js' -o \
  -name '*.json' -o \
  -name '*.svg' -o \
  -name '*.ttf' -o \
  -name '*.webmanifest' -o \
  -name '*.wasm' \
  \) -exec gzip -k -9 {} \;

CMD ["caddy", "run"]
