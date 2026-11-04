FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node *.js ./
COPY --chown=node:node public ./public
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production PORT=3000 VOXORA_HOST=0.0.0.0 VOXORA_DATA_DIR=/data
EXPOSE 3000
HEALTHCHECK --interval=20s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/api/info').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
