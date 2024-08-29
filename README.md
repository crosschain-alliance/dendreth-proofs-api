# DendrETH proof API

This repository provides event proof api from DendrETH light client, and relayer & executor logic to listen event from Yaho, and verify proof on DendrETH Adapter.

1. `packages/server`: Prover API logic
2. `packages/relayer`: Listen to `MessageDispatched` event from Yaho, and call `verifyAndStoreDispatchedMessage` on DendrETH Adapter contract.

## Dev

```
cd packages/server or cd packages/server
yarn install
yarn start
```

## Run docker

```
docker-compose build
docker-compose up
```
