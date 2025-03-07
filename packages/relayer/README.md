# DendrETH proof API Relayer

DendrETH proof API Relayer is facilitating with the API server to fetch proof of an event and verify the proof on DendrETH Adapter contract.

## Workflow

1. Watch for `HashStored` event on DendrETH Adapter, in order to get the latest stored block number, on target chain.
2. Once get the block number in `HashStored`, we query the Yaho `MessageDispatched` event from blockNum - maxBlockWindow to blockNum, on source chain.
3. Get the event proof from API server and call `verifyAndStoreDispatchedMessage` on DendrETH Adapter on target chain.

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
cd packages/relayer
yarn start:dev
```

This command typically runs the server using a development configuration, where any code changes automatically restart the server.

### Production Mode

To start the application in production mode, use:

```bash
cd packages/relayer
yarn start
```

# Configuration

```
1. SOURCE_YAHO_ADDRESS: yaho address on source chain
2. LIGHT_CLIENT_ADDRESS: light client address on target chain that emits `HashStored`
3. LIGHT_CLIENT_ADAPTER_ADDRESS: light client adapter address on target chain that verify the proof and store hash
4. PROOF_API= <http://server_name:port>
5. PRIVATE_KEY= private key from the address that calls target chain's verification function
6. SOURCE_CHAIN_ID: source chain Id
7. TARGET_CHAIN_ID: destination chain Id
8. WATCH_INTERVAL_TIME_MS: interval for event listener to watch `HashStored` event, in ms
9. SOURCE_RPC: rpc for source chain
10. TARGET_RPC: rpc for target chain
11. MAX_BLOCK_WINDOW: max number of block to watch prior to the block number that light client has updated w.r.t source chain
12. MAX_EVENT_TO_PROVE: max event to prove in a single proof cycle(every block header stored event), set -1 if prove all
13. INITIAL_QUERY_FROM_BLOCK: initial 'from' block to query light client's `HashStored` block header update on Adapter
14. SERVER_REQUEST_TIMEOUT: timeout for the relayer to call server, in ms
15. RABBITMQ_URL: amqp://rabbitmq:5672
16. REDIS_URL=redis://redis:6379
17. LC_TYPE: light client type("helios" or "dendreth")
18. BEACONCHA_IN_URL: https://gnosischa.in or https://beaconcha.in
19. LOG_LEVEL: default to info
```
