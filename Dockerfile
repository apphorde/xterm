FROM ghcr.io/cloud-cli/image-static:latest

COPY . /home/app

USER root
RUN cd /home/app && pnpm install --frozen-lockfile && \
  rm -f /home/app/superstatic.json && \
  chmod -R a+rX /home/app && \
  chown -R 1000:1000 /home/app
USER 1000
