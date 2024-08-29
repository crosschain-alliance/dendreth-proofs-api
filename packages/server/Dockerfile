FROM node:18-alpine

WORKDIR /usr/src/app/packages/server

COPY ./packages/server/package.json ./packages/server/yarn.lock ./

RUN yarn install

COPY  ./packages/server .

CMD ["node", "./src/server.js"]