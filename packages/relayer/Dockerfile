FROM node:18-alpine

WORKDIR /usr/src/app/packages/relayer

COPY ./packages/relayer/package.json ./

RUN yarn install

COPY  ./packages/relayer .

CMD ["node","index.js"]