import * as dotenv from "dotenv";
dotenv.config();

export const TEST_DEPLOYER_PK = process.env.TEST_DEPLOYER_PK;
export const TEST_ETH_RPC = process.env.TEST_ETH_RPC;
export const TEST_ETH_CHAIN_ID = process.env.TEST_ETH_CHAIN_ID;

export const TEST_FUND = process.env.TEST_FUND ?? "";
export const TEST_CHESS = process.env.TEST_CHESS ?? "";
export const TEST_CHESS_CONTROLLER = process.env.TEST_CHESS_CONTROLLER ?? "";
export const TEST_USDC = process.env.TEST_USDC ?? "";
export const TEST_VOTING_ESCROW = process.env.TEST_VOTING_ESCROW ?? "";
export const TEST_MIN_ORDER_AMOUNT = process.env.TEST_MIN_ORDER_AMOUNT ?? "";
export const TEST_MAKER_REQUIREMENT = process.env.TEST_MAKER_REQUIREMENT ?? "";

export const STAGING_DEPLOYER_PK = process.env.STAGING_DEPLOYER_PK;
export const STAGING_ETH_RPC = process.env.STAGING_ETH_RPC;
export const STAGING_ETH_CHAIN_ID = process.env.STAGING_ETH_CHAIN_ID;

export const STAGING_FUND = process.env.STAGING_FUND ?? "";
export const STAGING_CHESS = process.env.STAGING_CHESS ?? "";
export const STAGING_CHESS_CONTROLLER = process.env.STAGING_CHESS_CONTROLLER ?? "";
export const STAGING_USDC = process.env.STAGING_USDC ?? "";
export const STAGING_VOTING_ESCROW = process.env.STAGING_VOTING_ESCROW ?? "";
export const STAGING_MIN_ORDER_AMOUNT = process.env.STAGING_MIN_ORDER_AMOUNT ?? "";
export const STAGING_MAKER_REQUIREMENT = process.env.STAGING_MAKER_REQUIREMENT ?? "";
