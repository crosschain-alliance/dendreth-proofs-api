FROM node:18-alpine

WORKDIR /usr/src/app/

# Copy root package.json and yarn.lock
COPY ./package.json ./yarn.lock ./
COPY ./packages/relayer/package.json ./packages/relayer/

# Install dependencies for the entire monorepo
RUN yarn install --production=false

# Copy only the relayer workspace
COPY packages/relayer ./packages/relayer

WORKDIR /usr/src/app/packages/relayer

CMD ["node", "index.js"]
