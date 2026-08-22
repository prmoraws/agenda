FROM node:22-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY src ./src

RUN mkdir -p /app/data/uploads && chown -R node:node /app/data

USER node
EXPOSE 3010
CMD ["npm", "start"]
