import { expect } from "chai";
import { Contract, Wallet } from "ethers";
import type { Fixture, MockContract, MockProvider } from "ethereum-waffle";
import { waffle, ethers } from "hardhat";
const { loadFixture } = waffle;
const { parseEther, parseUnits } = ethers.utils;
const parseUsdc = (value: string) => parseUnits(value, 6);
import { deployMockForName } from "./mock";
import { start } from "node:repl";

const EPOCH = 1800; // 30 min
const WEEK = 7 * 86400;
const TRANCHE_P = 0;
const TRANCHE_A = 1;
const TRANCHE_B = 2;
const USER1_USDC = parseUsdc("100000");
const USER1_P = parseEther("10000");
const USER1_A = parseEther("20000");
const USER1_B = parseEther("30000");
const USER2_USDC = parseUsdc("200000");
const USER2_P = parseEther("20000");
const USER2_A = parseEther("40000");
const USER2_B = parseEther("60000");
const MIN_BID_AMOUNT = parseUsdc("1");
const MIN_ASK_AMOUNT = parseEther("1");
const MAKER_REQUIREMENT = parseEther("10000");

async function advanceBlockAtTime(time: number) {
    await ethers.provider.send("evm_mine", [time]);
}

describe("Exchange", function () {
    interface FixtureWalletMap {
        readonly [name: string]: Wallet;
    }

    interface FixtureData {
        readonly wallets: FixtureWalletMap;
        readonly startEpoch: number;
        readonly fund: MockContract;
        readonly shareP: MockContract;
        readonly shareA: MockContract;
        readonly shareB: MockContract;
        readonly twapOracle: MockContract;
        readonly chess: MockContract;
        readonly chessController: MockContract;
        readonly usdc: Contract;
        readonly exchange: Contract;
    }

    let currentFixture: Fixture<FixtureData>;
    let fixtureData: FixtureData;

    let user1: Wallet;
    let user2: Wallet;
    let user3: Wallet;
    let owner: Wallet;
    let addr1: string;
    let addr2: string;
    let addr3: string;
    let startEpoch: number;
    let fund: MockContract;
    let shareP: MockContract;
    let shareA: MockContract;
    let shareB: MockContract;
    let twapOracle: MockContract;
    let chess: MockContract;
    let chessController: MockContract;
    let usdc: Contract;
    let exchange: Contract;

    let tranche_list: { tranche: number; share: MockContract }[];

    async function deployFixture(_wallets: Wallet[], provider: MockProvider): Promise<FixtureData> {
        const [user1, user2, user3, owner] = provider.getWallets();

        let startEpoch = (await ethers.provider.getBlock("latest")).timestamp;
        startEpoch = Math.ceil(startEpoch / EPOCH) * EPOCH + EPOCH * 10;
        const endWeek = Math.floor(startEpoch / WEEK) * WEEK + WEEK * 2;
        await advanceBlockAtTime(startEpoch - EPOCH);

        const fund = await deployMockForName(owner, "IFund");
        const shareP = await deployMockForName(owner, "IERC20");
        const shareA = await deployMockForName(owner, "IERC20");
        const shareB = await deployMockForName(owner, "IERC20");
        const twapOracle = await deployMockForName(owner, "ITwapOracle");
        await fund.mock.tokenP.returns(shareP.address);
        await fund.mock.tokenA.returns(shareA.address);
        await fund.mock.tokenB.returns(shareB.address);
        await fund.mock.getConversionSize.returns(0);
        await fund.mock.twapOracle.returns(twapOracle.address);
        await fund.mock.endOfWeek.returns(endWeek);
        await fund.mock.getConversionTimestamp.returns(endWeek);
        await twapOracle.mock.getTwap.returns(parseEther("1000"));

        const chess = await deployMockForName(owner, "IChess");
        await chess.mock.futureDayTimeWrite.returns(endWeek, 0);

        const chessController = await deployMockForName(owner, "IChessController");
        await chessController.mock.getFundRelativeWeight.returns(parseEther("1"));

        const MockToken = await ethers.getContractFactory("MockToken");
        const usdc = await MockToken.connect(owner).deploy("USD Coin", "USDC", 6);

        const votingEscrow = await deployMockForName(owner, "IVotingEscrow");

        const Exchange = await ethers.getContractFactory("Exchange");
        const exchangeImpl = await Exchange.connect(owner).deploy(
            fund.address,
            chess.address,
            chessController.address,
            usdc.address,
            6,
            votingEscrow.address,
            MIN_BID_AMOUNT,
            MIN_ASK_AMOUNT
        );
        const TranchessProxy = await ethers.getContractFactory("TranchessProxy");
        const exchangeProxy = await TranchessProxy.connect(owner).deploy(
            exchangeImpl.address,
            owner.address,
            "0x"
        );

        const exchange = Exchange.attach(exchangeProxy.address);
        await exchange.init(MAKER_REQUIREMENT);

        // Initialize balance
        await shareP.mock.transferFrom.returns(true);
        await shareA.mock.transferFrom.returns(true);
        await shareB.mock.transferFrom.returns(true);
        await exchange.connect(user1).deposit(TRANCHE_P, USER1_P);
        await exchange.connect(user1).deposit(TRANCHE_A, USER1_A);
        await exchange.connect(user1).deposit(TRANCHE_B, USER1_B);
        await exchange.connect(user2).deposit(TRANCHE_P, USER2_P);
        await exchange.connect(user2).deposit(TRANCHE_A, USER2_A);
        await exchange.connect(user2).deposit(TRANCHE_B, USER2_B);
        await shareP.mock.transferFrom.revertsWithReason("Mock on the method is not initialized");
        await shareA.mock.transferFrom.revertsWithReason("Mock on the method is not initialized");
        await shareB.mock.transferFrom.revertsWithReason("Mock on the method is not initialized");
        await usdc.mint(user1.address, USER1_USDC);
        await usdc.mint(user2.address, USER2_USDC);
        await usdc.connect(user1).approve(exchange.address, USER1_USDC);
        await usdc.connect(user2).approve(exchange.address, USER2_USDC);

        // Grant user1 and user2 to be maker for 1000 epochs
        await votingEscrow.mock.getTimestampDropBelow.returns(startEpoch + EPOCH * 1000);
        await exchange.connect(user1).applyForMaker();
        await exchange.connect(user2).applyForMaker();
        await votingEscrow.mock.getTimestampDropBelow.revertsWithReason(
            "Mock on the method is not initialized"
        );

        return {
            wallets: { user1, user2, user3, owner },
            startEpoch,
            fund,
            shareP,
            shareA,
            shareB,
            twapOracle,
            chess,
            chessController,
            usdc,
            exchange: exchange.connect(user1),
        };
    }

    before(function () {
        currentFixture = deployFixture;
    });

    beforeEach(async function () {
        fixtureData = await loadFixture(currentFixture);
        user1 = fixtureData.wallets.user1;
        user2 = fixtureData.wallets.user2;
        user3 = fixtureData.wallets.user3;
        owner = fixtureData.wallets.owner;
        addr1 = user1.address;
        addr2 = user2.address;
        addr3 = user3.address;
        startEpoch = fixtureData.startEpoch;
        fund = fixtureData.fund;
        shareP = fixtureData.shareP;
        shareA = fixtureData.shareA;
        shareB = fixtureData.shareB;
        twapOracle = fixtureData.twapOracle;
        chess = fixtureData.chess;
        chessController = fixtureData.chessController;
        usdc = fixtureData.usdc;
        exchange = fixtureData.exchange;

        tranche_list = [
            { tranche: TRANCHE_P, share: shareP },
            { tranche: TRANCHE_A, share: shareA },
            { tranche: TRANCHE_B, share: shareB },
        ];
    });

    describe("Proxy", function () {
        it("Should be properly initialized in a proxy's point of view", async function () {
            expect(await exchange.fund()).to.equal(fund.address);
            expect(await exchange.tokenP()).to.equal(shareP.address);
            expect(await exchange.tokenA()).to.equal(shareA.address);
            expect(await exchange.tokenB()).to.equal(shareB.address);
            expect(await exchange.minBidAmount()).to.equal(MIN_BID_AMOUNT);
            expect(await exchange.minAskAmount()).to.equal(MIN_ASK_AMOUNT);
            expect(await exchange.makerRequirement()).to.equal(MAKER_REQUIREMENT);
        });
    });

    describe("endOfEpoch()", function () {
        it("Should return end of an epoch", async function () {
            expect(await exchange.endOfEpoch(startEpoch - EPOCH)).to.equal(startEpoch);
            expect(await exchange.endOfEpoch(startEpoch - 1)).to.equal(startEpoch);
            expect(await exchange.endOfEpoch(startEpoch)).to.equal(startEpoch + EPOCH);
        });
    });

    describe("placeBid()", function () {
        it("Should check maker expiration", async function () {
            await expect(
                exchange.connect(user3).placeBid(TRANCHE_P, 0, MIN_BID_AMOUNT, 0, 0)
            ).to.be.revertedWith("Only maker");
            await advanceBlockAtTime(startEpoch + EPOCH * 1000);
            await expect(exchange.placeBid(TRANCHE_P, 0, MIN_BID_AMOUNT, 0, 0)).to.be.revertedWith(
                "Only maker"
            );
        });

        it("Should check min amount", async function () {
            await expect(
                exchange.placeBid(TRANCHE_P, 0, MIN_BID_AMOUNT.sub(1), 0, 0)
            ).to.be.revertedWith("Quote amount too low");
        });

        it("Should check pd level", async function () {
            await expect(exchange.placeBid(TRANCHE_P, 81, MIN_BID_AMOUNT, 0, 0)).to.be.revertedWith(
                "Invalid premium-discount level"
            );
        });

        it("Should check conversion ID", async function () {
            await expect(exchange.placeBid(TRANCHE_P, 0, MIN_BID_AMOUNT, 1, 0)).to.be.revertedWith(
                "Invalid conversion ID"
            );
        });

        it("Should transfer USDC", async function () {
            for (const { tranche } of tranche_list) {
                await expect(() =>
                    exchange.placeBid(tranche, 0, parseUsdc("100"), 0, 0)
                ).to.changeTokenBalances(
                    usdc,
                    [user1, exchange],
                    [parseUsdc("-100"), parseUsdc("100")]
                );
            }
        });

        it("Should update best bid premium-discount level", async function () {
            for (const { tranche } of tranche_list) {
                await exchange.placeBid(tranche, 40, parseUsdc("100"), 0, 0);
                expect(await exchange.bestBids(0, tranche)).to.equal(40);
                await exchange.placeBid(tranche, 60, parseUsdc("100"), 0, 0);
                expect(await exchange.bestBids(0, tranche)).to.equal(60);
                await exchange.placeBid(tranche, 50, parseUsdc("100"), 0, 0);
                expect(await exchange.bestBids(0, tranche)).to.equal(60);
            }
        });

        it("Should append order to order queue", async function () {
            for (const { tranche } of tranche_list) {
                await exchange.placeBid(tranche, 40, parseUsdc("100"), 0, 0);
                const order1 = await exchange.getBidOrder(0, tranche, 40, 1);
                expect(order1.maker).to.equal(addr1);
                expect(order1.amount).to.equal(parseUsdc("100"));
                expect(order1.fillable).to.equal(parseUsdc("100"));

                await exchange.connect(user2).placeBid(tranche, 40, parseUsdc("200"), 0, 0);
                const order2 = await exchange.getBidOrder(0, tranche, 40, 2);
                expect(order2.maker).to.equal(addr2);
                expect(order2.amount).to.equal(parseUsdc("200"));
                expect(order2.fillable).to.equal(parseUsdc("200"));
            }
        });
    });

    describe("placeAsk()", function () {
        it("Should check maker expiration", async function () {
            await expect(
                exchange.connect(user3).placeAsk(TRANCHE_P, 0, MIN_ASK_AMOUNT, 0, 0)
            ).to.be.revertedWith("Only maker");
            await advanceBlockAtTime(startEpoch + EPOCH * 1000);
            await expect(exchange.placeAsk(TRANCHE_P, 0, MIN_ASK_AMOUNT, 0, 0)).to.be.revertedWith(
                "Only maker"
            );
        });

        it("Should check min amount", async function () {
            await expect(
                exchange.placeAsk(TRANCHE_P, 0, MIN_ASK_AMOUNT.sub(1), 0, 0)
            ).to.be.revertedWith("Base amount too low");
        });

        it("Should check pd level", async function () {
            await expect(exchange.placeAsk(TRANCHE_P, 81, MIN_ASK_AMOUNT, 0, 0)).to.be.revertedWith(
                "Invalid premium-discount level"
            );
        });

        it("Should check conversion ID", async function () {
            await expect(exchange.placeAsk(TRANCHE_P, 0, MIN_ASK_AMOUNT, 1, 0)).to.be.revertedWith(
                "Invalid conversion ID"
            );
        });

        it("Should lock share tokens", async function () {
            for (const { tranche } of tranche_list) {
                await exchange.placeAsk(tranche, 0, parseEther("100"), 0, 0);
                expect(await exchange.lockedBalanceOf(tranche, addr1)).to.equal(parseEther("100"));
            }
        });

        it("Should revert if balance is not enough", async function () {
            await expect(exchange.placeAsk(TRANCHE_P, 0, USER1_P.add(1), 0, 0)).to.be.revertedWith(
                "Insufficient balance to lock"
            );
            await expect(exchange.placeAsk(TRANCHE_A, 0, USER1_A.add(1), 0, 0)).to.be.revertedWith(
                "Insufficient balance to lock"
            );
            await expect(exchange.placeAsk(TRANCHE_B, 0, USER1_B.add(1), 0, 0)).to.be.revertedWith(
                "Insufficient balance to lock"
            );
        });

        it("Should update best ask premium-discount level", async function () {
            for (const { tranche } of tranche_list) {
                await exchange.placeAsk(tranche, 40, parseEther("1"), 0, 0);
                expect(await exchange.bestAsks(0, tranche)).to.equal(40);
                await exchange.placeAsk(tranche, 20, parseEther("1"), 0, 0);
                expect(await exchange.bestAsks(0, tranche)).to.equal(20);
                await exchange.placeAsk(tranche, 30, parseEther("1"), 0, 0);
                expect(await exchange.bestAsks(0, tranche)).to.equal(20);
            }
        });

        it("Should append order to order queue", async function () {
            for (const { tranche } of tranche_list) {
                await exchange.placeAsk(tranche, 40, parseEther("1"), 0, 0);
                const order1 = await exchange.getAskOrder(0, tranche, 40, 1);
                expect(order1.maker).to.equal(addr1);
                expect(order1.amount).to.equal(parseEther("1"));
                expect(order1.fillable).to.equal(parseEther("1"));

                await exchange.connect(user2).placeAsk(tranche, 40, parseEther("2"), 0, 0);
                const order2 = await exchange.getAskOrder(0, tranche, 40, 2);
                expect(order2.maker).to.equal(addr2);
                expect(order2.amount).to.equal(parseEther("2"));
                expect(order2.fillable).to.equal(parseEther("2"));
            }
        });
    });

    describe("buyP", function () {
        it("Should revert if price is not available", async function () {
            await twapOracle.mock.getTwap.returns(parseEther("0"));
            await expect(exchange.buyP(0, 40, 1)).to.be.revertedWith("Price is not available");
        });

        it("Should check pd level", async function () {
            await fund.mock.extrapolateNav.returns(
                parseEther("1"),
                parseEther("1"),
                parseEther("1")
            );
            await expect(exchange.buyP(0, 81, 1)).to.be.revertedWith(
                "Invalid premium-discount level"
            );
        });

        it("Should do nothing if no order can be matched", async function () {
            await fund.mock.extrapolateNav.returns(
                parseEther("1"),
                parseEther("1"),
                parseEther("1")
            );
            await exchange.buyP(0, 40, 1);
            expect(await usdc.balanceOf(addr1)).to.equal(USER1_USDC);
        });

        it("Should match at estimated NAV when taker is completely filled", async function () {
            await exchange.connect(user2).placeAsk(TRANCHE_P, 40, parseEther("10"), 0, 0);

            // 10 USDC buys 5 P at NAV 2, 5.5 P is frozen
            await fund.mock.extrapolateNav.returns(parseEther("2"), 0, 0);
            await exchange.buyP(0, 48, parseUsdc("10"));

            const order = await exchange.getAskOrder(0, TRANCHE_P, 40, 1);
            expect(order.fillable).to.equal(parseEther("4.5"));
            expect(await usdc.balanceOf(addr1)).to.equal(USER1_USDC.sub(parseUsdc("10")));
            expect(await usdc.balanceOf(exchange.address)).to.equal(parseUsdc("10"));
        });

        it("Should match at estimated NAV when maker is completely filled", async function () {
            await exchange.connect(user2).placeAsk(TRANCHE_P, 40, parseEther("11"), 0, 0);

            // 20 USDC buys 10 P at NAV 2, 11 P is frozen
            await fund.mock.extrapolateNav.returns(parseEther("2"), 0, 0);
            await exchange.buyP(0, 48, parseUsdc("30"));

            const order = await exchange.getAskOrder(0, TRANCHE_P, 40, 1);
            expect(order.fillable).to.equal(parseEther("0"));
            expect(await usdc.balanceOf(addr1)).to.equal(USER1_USDC.sub(parseUsdc("20")));
            expect(await usdc.balanceOf(exchange.address)).to.equal(parseUsdc("20"));
        });
    });

    describe("sellP", function () {
        it("Should revert if price is not available", async function () {
            await twapOracle.mock.getTwap.returns(parseEther("0"));
            await expect(exchange.sellP(0, 40, 1)).to.be.revertedWith("Price is not available");
        });

        it("Should check pd level", async function () {
            await fund.mock.extrapolateNav.returns(
                parseEther("1"),
                parseEther("1"),
                parseEther("1")
            );
            await expect(exchange.sellP(0, 81, 1)).to.be.revertedWith(
                "Invalid premium-discount level"
            );
        });

        it("Should do nothing if no order can be matched", async function () {
            await fund.mock.extrapolateNav.returns(
                parseEther("1"),
                parseEther("1"),
                parseEther("1")
            );
            await exchange.sellP(0, 40, 1);
            expect(await exchange.availableBalanceOf(TRANCHE_P, addr1)).to.equal(USER1_P);
        });

        it("Should match at estimated NAV when taker is completely filled", async function () {
            await exchange.placeBid(TRANCHE_P, 40, parseUsdc("10"), 0, 0);

            // 10 P sells for 5 USDC at NAV 0.5, 5.5 USDC is frozen
            await fund.mock.extrapolateNav.returns(parseEther("0.5"), 0, 0);
            await exchange.sellP(0, 32, parseEther("10"));

            const order = await exchange.getBidOrder(0, TRANCHE_P, 40, 1);
            expect(order.fillable).to.equal(parseUsdc("4.5"));
            expect(await exchange.availableBalanceOf(TRANCHE_P, addr1)).to.equal(
                USER1_P.sub(parseEther("10"))
            );
        });

        it("Should match at estimated NAV when maker is completely filled", async function () {
            await exchange.placeBid(TRANCHE_P, 40, parseUsdc("11"), 0, 0);

            // 20 P sells for 10 USDC at NAV 0.5, 11 USDC is frozen
            await fund.mock.extrapolateNav.returns(parseEther("0.5"), 0, 0);
            await exchange.sellP(0, 32, parseEther("30"));

            const order = await exchange.getBidOrder(0, TRANCHE_P, 40, 1);
            expect(order.fillable).to.equal(parseEther("0"));
            expect(await exchange.availableBalanceOf(TRANCHE_P, addr1)).to.equal(
                USER1_P.sub(parseEther("20"))
            );
        });
    });
});
