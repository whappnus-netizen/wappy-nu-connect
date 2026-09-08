FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
ENV SESSIONS_DIR=/data/sessions
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "server.js"]
