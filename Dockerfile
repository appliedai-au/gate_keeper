# Gate Keeper: isolated TrueForge hosted runtime, matched to starter SDK 0.180.0.
FROM node:24.19.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund \
    && npm install --no-save --package-lock=false --no-audit --no-fund @truefoundry/trueforge@0.180.0
COPY . .
ENV NODE_ENV=production \
    STANDALONE=false \
    HOST=0.0.0.0 \
    PORT=8790
USER node
EXPOSE 8790
HEALTHCHECK --interval=20s --timeout=5s --start-period=60s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:8790/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "node_modules/@truefoundry/trueforge/dist/main.js"]
