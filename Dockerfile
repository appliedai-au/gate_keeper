# Gate Keeper: isolated TrueForge hosted runtime, matched to starter SDK 0.180.0.
# TRUEFORGE_VERSION defaults to 0.180.0. The isolated qualification service
# sets 0.182.0: 0.180/0.181 send `anthropic-beta: fine-grained-tool-streaming`
# to the truefoundry provider; that header is the suspected cause of the
# gateway's DeepSeek stream being unparseable (AI_JSONParseError, run gk-native-deepseek-hard-four-20261103-a).
FROM node:24.19.0-bookworm-slim
ARG TRUEFORGE_VERSION=0.180.0
WORKDIR /app
COPY package.json package-lock.json ./
RUN case "$TRUEFORGE_VERSION" in 0.180.0|0.182.0) ;; *) echo "unapproved TrueForge version $TRUEFORGE_VERSION"; exit 1;; esac \
    && npm ci --no-audit --no-fund \
    && npm install --no-save --package-lock=false --no-audit --no-fund "@truefoundry/trueforge@${TRUEFORGE_VERSION}"
COPY . .
ENV NODE_ENV=production \
    STANDALONE=false \
    HOST=0.0.0.0 \
    PORT=8790
USER node
EXPOSE 8790
HEALTHCHECK --interval=20s --timeout=5s --start-period=60s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT || '8790') +'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "node_modules/@truefoundry/trueforge/dist/main.js"]
