This repo is **deprecated** and will not be further maintained.

[Tranchess-Core](https://github.com/tranchess/contract-core/) is the new monorepo under active development.

---

# Tranchess Exchange

Tranchess exchange.

# Local Development

## Install Dependencies

`npm install`

## Compile Contracts

`npx hardhat compile`

## Run Tests

`npm test`

## Check Lint and Format

`npm run check`

## Deploy Contracts

Copy `.env.example` to `.env` and modify configurations in the file.

Deploy contracts by `npm run deploy --network <network>`, where `<network>` can be `test` or `staging`.
