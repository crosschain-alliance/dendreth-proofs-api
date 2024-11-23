FROM node:18-alpine

WORKDIR /usr/src/app/

# Copy root package.json and yarn.lock
COPY ./package.json ./yarn.lock ./
COPY ./packages/server/package.json ./packages/server/


# Install dependencies for the entire monorepo
RUN yarn install --production=false

# Copy only the server workspace
COPY packages/server ./packages/server

WORKDIR /usr/src/app/packages/server

CMD ["node", "--max-old-space-size=4096", "./src/server.js"]
