# NOT TESTED in the build environment (no Docker there). Treat as a starting point.
# Usage:
#   docker build -t tockmux .
#   docker run --rm -v "$PWD":/work tockmux render promo.html -o out.mp4
FROM node:20-bookworm-slim
RUN npm install -g tockmux \
 && npx playwright-core install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* /root/.npm
# Chromium needs --no-sandbox when running as root in a container.
ENV TOCKMUX_NO_SANDBOX=1
WORKDIR /work
ENTRYPOINT ["tockmux"]
CMD ["help"]
