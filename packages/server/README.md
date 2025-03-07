# Dendreth Proofs API

Dendreth Proofs API is a Node.js-based API that provides functionality for generating Dendreth proofs to use with Hashi

# Dev

Install the dependencies using Yarn:

```bash
cd ../.. # at root level
yarn install
```

## Running the Application

### Development Mode

To start the application in development mode with hot-reloading, use the following command:

```bash
cd packages/server
yarn start:dev
```

This command typically runs the server using a development configuration, where any code changes automatically restart the server.

### Production Mode

To start the application in production mode, use:

```bash
cd packages/server
yarn start
```

This command runs the server with the production configuration, optimized for performance.

# Configuration

```
1. PORT: port number exposed by server
2. SOURCE_RPC: rpc of source chain
3. TARGET_RPC: rpc of target chain
4. SOURCE_CHAIN_ID: source chain id
5. TARGET_CHAIN_ID: target chain id
6. LIGHT_CLIENT_ADDRESS: light client address on target chain
7. LIGHT_CLIENT_ADAPTER_ADDRESS: light client adapter address on target chain
8. SOURCE_BEACON_API_URL: beacon api url of source chain
9. BEACONCHA_IN_URL: https://gnosischa.in or https://beaconcha.in
10. LODESTAR_PRESET: (gnosis) optional config, only needed if source chain is gnosis
```
