import { task } from "hardhat/config";
import fs = require("fs");
import path = require("path");
import editJsonFile = require("edit-json-file");
import {
    TEST_FUND,
    TEST_CHESS,
    TEST_USDC,
    TEST_VOTING_ESCROW,
    TEST_MIN_ORDER_AMOUNT,
    TEST_MAKER_REQUIREMENT,
    STAGING_FUND,
    STAGING_CHESS,
    STAGING_USDC,
    STAGING_VOTING_ESCROW,
    STAGING_MIN_ORDER_AMOUNT,
    STAGING_MAKER_REQUIREMENT,
} from "../config";

task("deploy", "Deploy contracts", async (_args, hre) => {
    const { ethers } = hre;
    const { parseEther, parseUnits } = ethers.utils;

    const CONTRACT_ADDRESS_DIR = path.join(__dirname, "..", "cache");
    if (!fs.existsSync(CONTRACT_ADDRESS_DIR)) {
        fs.mkdirSync(CONTRACT_ADDRESS_DIR);
    }
    const contractAddress = editJsonFile(path.join(CONTRACT_ADDRESS_DIR, "contract_address.json"), {
        autosave: true,
    });
    const [deployer] = await ethers.getSigners();

    await hre.run("compile");

    let fundAddress;
    let chessAddress;
    let usdcAddress;
    let votingEscrowAddress;
    let minOrderAmount;
    let makerRequirement;
    if (hre.network.name === "test") {
        fundAddress = TEST_FUND;
        chessAddress = TEST_CHESS;
        usdcAddress = TEST_USDC;
        votingEscrowAddress = TEST_VOTING_ESCROW;
        minOrderAmount = TEST_MIN_ORDER_AMOUNT;
        makerRequirement = TEST_MAKER_REQUIREMENT;
    } else if (hre.network.name === "staging") {
        fundAddress = STAGING_FUND;
        chessAddress = STAGING_CHESS;
        usdcAddress = STAGING_USDC;
        votingEscrowAddress = STAGING_VOTING_ESCROW;
        minOrderAmount = STAGING_MIN_ORDER_AMOUNT;
        makerRequirement = STAGING_MAKER_REQUIREMENT;
    } else {
        console.error("ERROR: Unknown hardhat network:", hre.network.name);
        return;
    }

    const usdc = await ethers.getContractAt("ERC20", usdcAddress);
    const usdcDecimals = await usdc.decimals();

    const ChessController = await ethers.getContractFactory("ChessController");
    const chessController = await ChessController.deploy();
    contractAddress.set("chess_controller", chessController.address);
    console.log("ChessController:", chessController.address);

    const Exchange = await ethers.getContractFactory("Exchange");
    const exchangeImpl = await Exchange.deploy(
        fundAddress,
        chessAddress,
        chessController.address,
        usdcAddress,
        usdcDecimals,
        votingEscrowAddress,
        parseUnits(minOrderAmount, usdcDecimals),
        parseEther(minOrderAmount)
    );
    contractAddress.set("exchange_impl", exchangeImpl.address);
    console.log("Exchange implementation:", exchangeImpl.address);

    const exchangeInitTx = await exchangeImpl.populateTransaction.init(
        parseEther(makerRequirement)
    );
    const TranchessProxy = await ethers.getContractFactory("TranchessProxy");
    const exchangeProxy = await TranchessProxy.deploy(
        exchangeImpl.address,
        deployer.address,
        exchangeInitTx.data
    );
    const exchange = Exchange.attach(exchangeProxy.address);
    contractAddress.set("exchange", exchange.address);
    console.log("Exchange:", exchange.address);

    const chess = await ethers.getContractAt("IChess", chessAddress);
    await chess.addMinter(exchange.address);
    console.log("Exchange is a CHESS minter now");

    const AccountData = await ethers.getContractFactory("AccountData");
    const accountData = await AccountData.deploy();
    contractAddress.set("account_data", accountData.address);
    console.log("AccountData:", accountData.address);
});
