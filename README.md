# DendrETH proof API

This repository provides event proof api from DendrETH light client, and relayer logic to listen event from Yaho, and verify proof on DendrETH Adapter.

1. `packages/server`: Prover API logic
2. `packages/relayer`: Listen to `HashStored` event from DendrETH Adapter, `MessageDispatched` event from Yaho, and call `verifyAndStoreDispatchedMessage` on DendrETH Adapter contract.

## Dev

### Prerequisites

Before running the application, ensure you have the following installed:

- [Node.js](https://nodejs.org/) (version 20.x or higher recommended)
- [Yarn](https://yarnpkg.com/) (version 1.x or higher)

### Installation

Clone the repository:

```bash
git clone https://github.com/crosschain-alliance/dendreth-proofs-api
```

Install

```bash
yarn install
```

Navitage to each individual packages

```bash
cd packages/server # or cdd packages/relayer
cp .env.example .env # configure the .env file
yarn start
```

The DendrETH Adapter contract addresses can be found [here](https://crosschain-alliance.gitbook.io/hashi/deployments/oracles#dendreth)

## Run docker

```
docker-compose up --build
```

## Contributing

Feel free to submit issues and pull requests. For major changes, please open an issue first to discuss what you would like to change.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
