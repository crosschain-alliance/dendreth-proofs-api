# DendrETH proof API Relayer

DendrETH proof API Relayer is facilitating with the API server to fetch proof of an event and verify the proof on DendrETH Adapter contract.

## Workflow

1. Watch for `HashStored` event on DendrETH Adapter, in order to get the latest stored block number, on target chain.
2. Once get the block number in `HashStored`, we query the Yaho `MessageDispatched` event from blockNum - maxBlockWindow to blockNum, on source chain.
3. Get the event proof from API server and call `verifyAndStoreDispatchedMessage` on DendrETH Adapter on target chain.

Install the dependencies using Yarn:

```bash
yarn install
```

## Running the Application

### Development Mode

To start the application in development mode with hot-reloading, use the following command:

```bash
yarn start:dev
```

This command typically runs the server using a development configuration, where any code changes automatically restart the server.

### Production Mode

To start the application in production mode, use:

```bash
yarn start
```
