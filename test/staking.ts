import { expect } from "chai";
import { BigNumber, Contract, Wallet } from "ethers";
import type { Fixture, MockContract, MockProvider } from "ethereum-waffle";
import { waffle, ethers } from "hardhat";
const { loadFixture } = waffle;
const { parseEther } = ethers.utils;
import { deployMockForName } from "./mock";

const WEEK = 7 * 86400;
const TRANCHE_P = 0;
const TRANCHE_A = 1;
const TRANCHE_B = 2;
const REWARD_WEIGHT_P = 2;
const REWARD_WEIGHT_A = 1;
const REWARD_WEIGHT_B = 3;

// Initial balance:
// User 1: 400 P + 100 A + 200 B
// User 2:         200 A + 100 B
// Reward weight:
// User 1: 400   +  50   + 300   = 750
// User 2:         100   + 150   = 250
// Total : 400   + 150   + 450   = 1000
const USER1_P = parseEther("400");
const USER1_A = parseEther("100");
const USER1_B = parseEther("100");
const USER2_P = parseEther("0");
const USER2_A = parseEther("200");
const USER2_B = parseEther("200");
const TOTAL_P = USER1_P.add(USER2_P);
const TOTAL_A = USER1_A.add(USER2_A);
const TOTAL_B = USER1_B.add(USER2_B);
const USER1_WEIGHT = USER1_P.mul(REWARD_WEIGHT_P)
    .add(USER1_A.mul(REWARD_WEIGHT_A))
    .add(USER1_B.mul(REWARD_WEIGHT_B))
    .div(REWARD_WEIGHT_P);
const USER2_WEIGHT = USER2_P.mul(REWARD_WEIGHT_P)
    .add(USER2_A.mul(REWARD_WEIGHT_A))
    .add(USER2_B.mul(REWARD_WEIGHT_B))
    .div(REWARD_WEIGHT_P);
const TOTAL_WEIGHT = USER1_WEIGHT.add(USER2_WEIGHT);

async function advanceBlockAtTime(time: number) {
    await ethers.provider.send("evm_mine", [time]);
}

async function setNextBlockTime(time: number) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [time]);
}

/**
 * Note that failed transactions are silently ignored when automining is disabled.
 */
async function setAutomine(flag: boolean) {
    await ethers.provider.send("evm_setAutomine", [flag]);
}

describe("Staking", function () {
    interface FixtureWalletMap {
        readonly [name: string]: Wallet;
    }

    interface FixtureData {
        readonly wallets: FixtureWalletMap;
        readonly checkpointTimestamp: number;
        readonly nextEpoch: number;
        readonly fund: MockContract;
        readonly shareP: MockContract;
        readonly shareA: MockContract;
        readonly shareB: MockContract;
        readonly chess: Contract;
        readonly chessController: MockContract;
        readonly usdc: Contract;
        readonly staking: Contract;
    }

    let currentFixture: Fixture<FixtureData>;
    let fixtureData: FixtureData;

    let checkpointTimestamp: number;
    let nextEpoch: number;
    let user1: Wallet;
    let user2: Wallet;
    let owner: Wallet;
    let addr1: string;
    let addr2: string;
    let fund: MockContract;
    let shareP: MockContract;
    let shareA: MockContract;
    let shareB: MockContract;
    let chess: Contract;
    let chessController: MockContract;
    let usdc: Contract;
    let staking: Contract;

    async function deployFixture(_wallets: Wallet[], provider: MockProvider): Promise<FixtureData> {
        const [user1, user2, owner] = provider.getWallets();

        const startEpoch = (await ethers.provider.getBlock("latest")).timestamp;
        advanceBlockAtTime(Math.floor(startEpoch / WEEK) * WEEK + WEEK);
        const endWeek = Math.floor(startEpoch / WEEK) * WEEK + WEEK * 2;
        const nextEpoch = endWeek + WEEK * 10;

        const fund = await deployMockForName(owner, "IFund");
        const shareP = await deployMockForName(owner, "IERC20");
        const shareA = await deployMockForName(owner, "IERC20");
        const shareB = await deployMockForName(owner, "IERC20");
        await fund.mock.tokenP.returns(shareP.address);
        await fund.mock.tokenA.returns(shareA.address);
        await fund.mock.tokenB.returns(shareB.address);
        await fund.mock.getConversionSize.returns(0);
        await fund.mock.getConversionTimestamp.returns(endWeek);

        const MockChess = await ethers.getContractFactory("MockChess");
        const chess = await MockChess.connect(owner).deploy("CHESS", "CHESS", 18);
        await chess.set(nextEpoch, parseEther("0"));

        const chessController = await deployMockForName(owner, "IChessController");
        await chessController.mock.getFundRelativeWeight.returns(parseEther("1"));

        const MockToken = await ethers.getContractFactory("MockToken");
        const usdc = await MockToken.connect(owner).deploy("USD Coin", "USDC", 6);

        const Staking = await ethers.getContractFactory("StakingTestWrapper");
        const staking = await Staking.connect(owner).deploy(
            fund.address,
            chess.address,
            chessController.address,
            usdc.address
        );

        // Deposit initial shares
        await shareP.mock.transferFrom.returns(true);
        await shareA.mock.transferFrom.returns(true);
        await shareB.mock.transferFrom.returns(true);
        await staking.connect(user1).deposit(TRANCHE_P, USER1_P);
        await staking.connect(user1).deposit(TRANCHE_A, USER1_A);
        await staking.connect(user1).deposit(TRANCHE_B, USER1_B);
        await staking.connect(user2).deposit(TRANCHE_P, USER2_P);
        await staking.connect(user2).deposit(TRANCHE_A, USER2_A);
        await staking.connect(user2).deposit(TRANCHE_B, USER2_B);
        const checkpointTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
        await shareP.mock.transferFrom.revertsWithReason("Mock on the method is not initialized");
        await shareA.mock.transferFrom.revertsWithReason("Mock on the method is not initialized");
        await shareB.mock.transferFrom.revertsWithReason("Mock on the method is not initialized");

        return {
            wallets: { user1, user2, owner },
            checkpointTimestamp,
            nextEpoch,
            fund,
            shareP,
            shareA,
            shareB,
            chess,
            chessController,
            usdc,
            staking: staking.connect(user1),
        };
    }

    before(function () {
        currentFixture = deployFixture;
    });

    beforeEach(async function () {
        fixtureData = await loadFixture(currentFixture);
        checkpointTimestamp = fixtureData.checkpointTimestamp;
        nextEpoch = fixtureData.nextEpoch;
        user1 = fixtureData.wallets.user1;
        user2 = fixtureData.wallets.user2;
        owner = fixtureData.wallets.owner;
        addr1 = user1.address;
        addr2 = user2.address;
        fund = fixtureData.fund;
        shareP = fixtureData.shareP;
        shareA = fixtureData.shareA;
        shareB = fixtureData.shareB;
        chess = fixtureData.chess;
        chessController = fixtureData.chessController;
        usdc = fixtureData.usdc;
        staking = fixtureData.staking;
    });

    describe("rewardWeight()", function () {
        it("Should return the weighted value", async function () {
            const p = 1000000;
            const a = 10000;
            const b = 100;
            expect(await staking.rewardWeight(1000000, 10000, 100)).to.equal(
                (p * REWARD_WEIGHT_P + a * REWARD_WEIGHT_A + b * REWARD_WEIGHT_B) / REWARD_WEIGHT_P
            );
        });
    });

    describe("deposit()", function () {
        it("Should transfer shares and update balance", async function () {
            // Create an empty contract
            const Staking = await ethers.getContractFactory("StakingTestWrapper");
            staking = await Staking.connect(owner).deploy(
                fund.address,
                chess.address,
                chessController.address,
                usdc.address
            );
            staking = staking.connect(user1);

            await expect(() => staking.deposit(TRANCHE_P, 10000)).to.callMocks({
                func: shareP.mock.transferFrom.withArgs(addr1, staking.address, 10000),
                rets: [true],
            });
            expect(await staking.availableBalanceOf(TRANCHE_P, addr1)).to.equal(10000);
            expect(await staking.totalSupply(TRANCHE_P)).to.equal(10000);
            await expect(() => staking.deposit(TRANCHE_A, 1000)).to.callMocks({
                func: shareA.mock.transferFrom.withArgs(addr1, staking.address, 1000),
                rets: [true],
            });
            expect(await staking.availableBalanceOf(TRANCHE_A, addr1)).to.equal(1000);
            expect(await staking.totalSupply(TRANCHE_A)).to.equal(1000);
            await expect(() => staking.deposit(TRANCHE_B, 100)).to.callMocks({
                func: shareB.mock.transferFrom.withArgs(addr1, staking.address, 100),
                rets: [true],
            });
            expect(await staking.availableBalanceOf(TRANCHE_B, addr1)).to.equal(100);
            expect(await staking.totalSupply(TRANCHE_B)).to.equal(100);
        });

        it("Should emit an event", async function () {
            await shareP.mock.transferFrom.returns(true);
            await expect(staking.deposit(TRANCHE_P, 10000))
                .to.emit(staking, "Deposited")
                .withArgs(TRANCHE_P, addr1, 10000);
            await shareA.mock.transferFrom.returns(true);
            await expect(staking.deposit(TRANCHE_A, 1000))
                .to.emit(staking, "Deposited")
                .withArgs(TRANCHE_A, addr1, 1000);
            await shareB.mock.transferFrom.returns(true);
            await expect(staking.deposit(TRANCHE_B, 100))
                .to.emit(staking, "Deposited")
                .withArgs(TRANCHE_B, addr1, 100);
        });
    });

    describe("withdraw()", function () {
        it("Should transfer shares and update balance", async function () {
            await expect(() => staking.withdraw(TRANCHE_P, 1000)).to.callMocks({
                func: shareP.mock.transfer.withArgs(addr1, 1000),
                rets: [true],
            });
            expect(await staking.availableBalanceOf(TRANCHE_P, addr1)).to.equal(USER1_P.sub(1000));
            expect(await staking.totalSupply(TRANCHE_P)).to.equal(TOTAL_P.sub(1000));
            await expect(() => staking.withdraw(TRANCHE_A, 100)).to.callMocks({
                func: shareA.mock.transfer.withArgs(addr1, 100),
                rets: [true],
            });
            expect(await staking.availableBalanceOf(TRANCHE_A, addr1)).to.equal(USER1_A.sub(100));
            expect(await staking.totalSupply(TRANCHE_A)).to.equal(TOTAL_A.sub(100));
            await expect(() => staking.withdraw(TRANCHE_B, 10)).to.callMocks({
                func: shareB.mock.transfer.withArgs(addr1, 10),
                rets: [true],
            });
            expect(await staking.availableBalanceOf(TRANCHE_B, addr1)).to.equal(USER1_B.sub(10));
            expect(await staking.totalSupply(TRANCHE_B)).to.equal(TOTAL_B.sub(10));
        });

        it("Should revert if balance is not enough", async function () {
            await expect(staking.withdraw(TRANCHE_P, USER1_P.add(1))).to.be.revertedWith(
                "Insufficient balance to withdraw"
            );
            await expect(staking.withdraw(TRANCHE_A, USER1_A.add(1))).to.be.revertedWith(
                "Insufficient balance to withdraw"
            );
            await expect(staking.withdraw(TRANCHE_B, USER1_B.add(1))).to.be.revertedWith(
                "Insufficient balance to withdraw"
            );
        });

        it("Should emit an event", async function () {
            await shareP.mock.transfer.returns(true);
            await expect(staking.withdraw(TRANCHE_P, 10000))
                .to.emit(staking, "Withdrawn")
                .withArgs(TRANCHE_P, addr1, 10000);
            await shareA.mock.transfer.returns(true);
            await expect(staking.withdraw(TRANCHE_A, 1000))
                .to.emit(staking, "Withdrawn")
                .withArgs(TRANCHE_A, addr1, 1000);
            await shareB.mock.transfer.returns(true);
            await expect(staking.withdraw(TRANCHE_B, 100))
                .to.emit(staking, "Withdrawn")
                .withArgs(TRANCHE_B, addr1, 100);
        });
    });

    describe("tradeAvailable()", function () {
        it("Should update balance", async function () {
            await staking.tradeAvailable(TRANCHE_P, addr1, 1000);
            expect(await staking.availableBalanceOf(TRANCHE_P, addr1)).to.equal(USER1_P.sub(1000));
            expect(await staking.totalSupply(TRANCHE_P)).to.equal(TOTAL_P.sub(1000));
            await staking.tradeAvailable(TRANCHE_A, addr1, 100);
            expect(await staking.availableBalanceOf(TRANCHE_A, addr1)).to.equal(USER1_A.sub(100));
            expect(await staking.totalSupply(TRANCHE_A)).to.equal(TOTAL_A.sub(100));
            await staking.tradeAvailable(TRANCHE_B, addr1, 10);
            expect(await staking.availableBalanceOf(TRANCHE_B, addr1)).to.equal(USER1_B.sub(10));
            expect(await staking.totalSupply(TRANCHE_B)).to.equal(TOTAL_B.sub(10));
        });

        it("Should revert if balance is not enough", async function () {
            await expect(staking.tradeAvailable(TRANCHE_P, USER1_P.add(1))).to.be.reverted;
            await expect(staking.tradeAvailable(TRANCHE_A, USER1_A.add(1))).to.be.reverted;
            await expect(staking.tradeAvailable(TRANCHE_B, USER1_B.add(1))).to.be.reverted;
        });
    });

    describe("convertAndClearTrade()", function () {
        it("Should update balance", async function () {
            await staking.convertAndClearTrade(addr1, 1000, 100, 10, 0);
            expect(await staking.availableBalanceOf(TRANCHE_P, addr1)).to.equal(USER1_P.add(1000));
            expect(await staking.totalSupply(TRANCHE_P)).to.equal(TOTAL_P.add(1000));
            expect(await staking.availableBalanceOf(TRANCHE_A, addr1)).to.equal(USER1_A.add(100));
            expect(await staking.totalSupply(TRANCHE_A)).to.equal(TOTAL_A.add(100));
            expect(await staking.availableBalanceOf(TRANCHE_B, addr1)).to.equal(USER1_B.add(10));
            expect(await staking.totalSupply(TRANCHE_B)).to.equal(TOTAL_B.add(10));
        });
    });

    describe("lock()", function () {
        it("Should update balance", async function () {
            await staking.lock(TRANCHE_P, addr1, 1000);
            expect(await staking.availableBalanceOf(TRANCHE_P, addr1)).to.equal(USER1_P.sub(1000));
            expect(await staking.lockedBalanceOf(TRANCHE_P, addr1)).to.equal(1000);
            expect(await staking.totalSupply(TRANCHE_P)).to.equal(TOTAL_P);
            await staking.lock(TRANCHE_A, addr1, 100);
            expect(await staking.availableBalanceOf(TRANCHE_A, addr1)).to.equal(USER1_A.sub(100));
            expect(await staking.lockedBalanceOf(TRANCHE_A, addr1)).to.equal(100);
            expect(await staking.totalSupply(TRANCHE_A)).to.equal(TOTAL_A);
            await staking.lock(TRANCHE_B, addr1, 10);
            expect(await staking.availableBalanceOf(TRANCHE_B, addr1)).to.equal(USER1_B.sub(10));
            expect(await staking.lockedBalanceOf(TRANCHE_B, addr1)).to.equal(10);
            expect(await staking.totalSupply(TRANCHE_B)).to.equal(TOTAL_B);
        });

        it("Should revert if balance is not enough", async function () {
            await expect(staking.lock(TRANCHE_P, addr1, USER1_P.add(1))).to.be.revertedWith(
                "Insufficient balance to lock"
            );
            await expect(staking.lock(TRANCHE_A, addr1, USER1_A.add(1))).to.be.revertedWith(
                "Insufficient balance to lock"
            );
            await expect(staking.lock(TRANCHE_B, addr1, USER1_B.add(1))).to.be.revertedWith(
                "Insufficient balance to lock"
            );
        });
    });

    describe("convertAndUnlock()", function () {
        it("Should update balance", async function () {
            await staking.lock(TRANCHE_P, addr1, 3000);
            await staking.lock(TRANCHE_A, addr1, 300);
            await staking.lock(TRANCHE_B, addr1, 30);

            await staking.convertAndUnlock(addr1, 1000, 100, 10, 0);
            expect(await staking.availableBalanceOf(TRANCHE_P, addr1)).to.equal(USER1_P.sub(2000));
            expect(await staking.lockedBalanceOf(TRANCHE_P, addr1)).to.equal(2000);
            expect(await staking.totalSupply(TRANCHE_P)).to.equal(TOTAL_P);
            expect(await staking.availableBalanceOf(TRANCHE_A, addr1)).to.equal(USER1_A.sub(200));
            expect(await staking.lockedBalanceOf(TRANCHE_A, addr1)).to.equal(200);
            expect(await staking.totalSupply(TRANCHE_A)).to.equal(TOTAL_A);
            expect(await staking.availableBalanceOf(TRANCHE_B, addr1)).to.equal(USER1_B.sub(20));
            expect(await staking.lockedBalanceOf(TRANCHE_B, addr1)).to.equal(20);
            expect(await staking.totalSupply(TRANCHE_B)).to.equal(TOTAL_B);
        });

        it("Should revert if balance is not enough", async function () {
            await staking.lock(TRANCHE_P, addr1, 3000);
            await staking.lock(TRANCHE_A, addr1, 300);
            await staking.lock(TRANCHE_B, addr1, 30);

            await expect(staking.convertAndUnlock(addr1, 3001, 0, 0, 0)).to.be.reverted;
            await expect(staking.convertAndUnlock(addr1, 0, 301, 0, 0)).to.be.reverted;
            await expect(staking.convertAndUnlock(addr1, 0, 0, 31, 0)).to.be.reverted;
        });
    });

    describe("tradeLocked()", function () {
        it("Should update balance", async function () {
            await staking.lock(TRANCHE_P, addr1, 3000);
            await staking.lock(TRANCHE_A, addr1, 300);
            await staking.lock(TRANCHE_B, addr1, 30);

            await staking.tradeLocked(TRANCHE_P, addr1, 1000);
            expect(await staking.lockedBalanceOf(TRANCHE_P, addr1)).to.equal(2000);
            expect(await staking.totalSupply(TRANCHE_P)).to.equal(TOTAL_P.sub(1000));
            await staking.tradeLocked(TRANCHE_A, addr1, 100);
            expect(await staking.lockedBalanceOf(TRANCHE_A, addr1)).to.equal(200);
            expect(await staking.totalSupply(TRANCHE_A)).to.equal(TOTAL_A.sub(100));
            await staking.tradeLocked(TRANCHE_B, addr1, 10);
            expect(await staking.lockedBalanceOf(TRANCHE_B, addr1)).to.equal(20);
            expect(await staking.totalSupply(TRANCHE_B)).to.equal(TOTAL_B.sub(10));
        });

        it("Should revert if balance is not enough", async function () {
            await staking.lock(TRANCHE_P, addr1, 3000);
            await staking.lock(TRANCHE_A, addr1, 300);
            await staking.lock(TRANCHE_B, addr1, 30);

            await expect(staking.tradeLocked(TRANCHE_P, addr1, 3001)).to.be.reverted;
            await expect(staking.tradeLocked(TRANCHE_A, addr1, 301)).to.be.reverted;
            await expect(staking.tradeLocked(TRANCHE_B, addr1, 31)).to.be.reverted;
        });
    });

    describe("rewardWeight", function () {
        it("Should calculate reward weight", async function () {
            expect(await staking.rewardWeight(1000, 0, 0)).to.equal(1000);
            expect(await staking.rewardWeight(0, 1000, 0)).to.equal(
                (1000 * REWARD_WEIGHT_A) / REWARD_WEIGHT_P
            );
            expect(await staking.rewardWeight(0, 0, 1000)).to.equal(
                (1000 * REWARD_WEIGHT_B) / REWARD_WEIGHT_P
            );
        });

        it("Should round down reward weight", async function () {
            // Assume weights of (P, A, B) are (2, 1, 3)
            expect(await staking.rewardWeight(0, 1, 0)).to.equal(0);
            expect(await staking.rewardWeight(0, 0, 1)).to.equal(1);
            expect(await staking.rewardWeight(0, 1, 1)).to.equal(2);
        });
    });

    describe("Conversion", function () {
        describe("availableBalanceOf()", function () {
            it("Should return converted balance", async function () {
                await fund.mock.getConversionSize.returns(3);
                await fund.mock.batchConvert
                    .withArgs(USER1_P, USER1_A, USER1_B, 0, 3)
                    .returns(123, 456, 789);
                expect(await staking.availableBalanceOf(TRANCHE_P, addr1)).to.equal(123);
                expect(await staking.availableBalanceOf(TRANCHE_A, addr1)).to.equal(456);
                expect(await staking.availableBalanceOf(TRANCHE_B, addr1)).to.equal(789);
            });

            it("Should not perform conversion if the original balance is zero (for P)", async function () {
                await staking.lock(TRANCHE_P, addr1, USER1_P);
                await staking.lock(TRANCHE_A, addr1, USER1_A);
                await staking.lock(TRANCHE_B, addr1, USER1_B);
                await fund.mock.getConversionSize.returns(3);
                expect(await staking.availableBalanceOf(TRANCHE_P, addr1)).to.equal(0);
            });

            it("Should not perform conversion if the original balance is zero (for A)", async function () {
                await staking.lock(TRANCHE_A, addr1, USER1_A);
                await fund.mock.getConversionSize.returns(3);
                expect(await staking.availableBalanceOf(TRANCHE_A, addr1)).to.equal(0);
            });

            it("Should not perform conversion if the original balance is zero (for B)", async function () {
                await staking.lock(TRANCHE_B, addr1, USER1_B);
                await fund.mock.getConversionSize.returns(3);
                expect(await staking.availableBalanceOf(TRANCHE_B, addr1)).to.equal(0);
            });
        });

        describe("lockedBalanceOf()", function () {
            it("Should return converted balance", async function () {
                await staking.lock(TRANCHE_P, addr1, USER1_P.div(2));
                await staking.lock(TRANCHE_A, addr1, USER1_A.div(3));
                await staking.lock(TRANCHE_B, addr1, USER1_B.div(5));
                await fund.mock.getConversionSize.returns(4);
                await fund.mock.batchConvert
                    .withArgs(USER1_P.div(2), USER1_A.div(3), USER1_B.div(5), 0, 4)
                    .returns(123, 456, 789);
                expect(await staking.lockedBalanceOf(TRANCHE_P, addr1)).to.equal(123);
                expect(await staking.lockedBalanceOf(TRANCHE_A, addr1)).to.equal(456);
                expect(await staking.lockedBalanceOf(TRANCHE_B, addr1)).to.equal(789);
            });

            it("Should not perform conversion if the original balance is zero (for P)", async function () {
                await fund.mock.getConversionSize.returns(4);
                expect(await staking.lockedBalanceOf(TRANCHE_P, addr1)).to.equal(0);
            });

            it("Should not perform conversion if the original balance is zero (for A)", async function () {
                await staking.lock(TRANCHE_P, addr1, USER1_P);
                await staking.lock(TRANCHE_B, addr1, USER1_B);
                await fund.mock.getConversionSize.returns(4);
                expect(await staking.lockedBalanceOf(TRANCHE_A, addr1)).to.equal(0);
            });

            it("Should not perform conversion if the original balance is zero (for B)", async function () {
                await staking.lock(TRANCHE_P, addr1, USER1_P);
                await staking.lock(TRANCHE_A, addr1, USER1_A);
                await fund.mock.getConversionSize.returns(4);
                expect(await staking.lockedBalanceOf(TRANCHE_B, addr1)).to.equal(0);
            });
        });

        describe("totalSupply()", function () {
            it("Should return converted total supply", async function () {
                await fund.mock.getConversionSize.returns(2);
                await fund.mock.batchConvert
                    .withArgs(TOTAL_P, TOTAL_A, TOTAL_B, 0, 2)
                    .returns(123, 456, 789);
                expect(await staking.totalSupply(TRANCHE_P)).to.equal(123);
                expect(await staking.totalSupply(TRANCHE_A)).to.equal(456);
                expect(await staking.totalSupply(TRANCHE_B)).to.equal(789);
            });
        });

        describe("refreshBalance()", function () {
            it("Non-zero targetVersion", async function () {
                await fund.mock.getConversionSize.returns(3);
                await fund.mock.getConversionTimestamp.withArgs(0).returns(checkpointTimestamp + 1);
                await fund.mock.getConversionTimestamp.withArgs(1).returns(checkpointTimestamp + 2);
                await fund.mock.getConversionTimestamp.withArgs(2).returns(checkpointTimestamp + 3);
                await advanceBlockAtTime(checkpointTimestamp + 100);
                await expect(() => staking.refreshBalance(addr1, 1)).to.callMocks(
                    {
                        func: fund.mock.convert.withArgs(TOTAL_P, TOTAL_A, TOTAL_B, 0),
                        rets: [10000, 1000, 100],
                    },
                    {
                        func: fund.mock.convert.withArgs(10000, 1000, 100, 1),
                        rets: [20000, 2000, 200],
                    },
                    {
                        func: fund.mock.convert.withArgs(20000, 2000, 200, 2),
                        rets: [30000, 3000, 300],
                    },
                    {
                        func: fund.mock.convert.withArgs(USER1_P, USER1_A, USER1_B, 0),
                        rets: [123, 456, 789],
                    }
                );
                expect(await staking.balanceVersion(addr1)).to.equal(1);
                await expect(() => staking.refreshBalance(addr1, 3)).to.callMocks(
                    {
                        func: fund.mock.convert.withArgs(123, 456, 789, 1),
                        rets: [1230, 4560, 7890],
                    },
                    {
                        func: fund.mock.convert.withArgs(1230, 4560, 7890, 2),
                        rets: [12300, 45600, 78900],
                    }
                );
                expect(await staking.balanceVersion(addr1)).to.equal(3);
                expect(await staking.availableBalanceOf(TRANCHE_P, addr1)).to.equal(12300);
                expect(await staking.availableBalanceOf(TRANCHE_A, addr1)).to.equal(45600);
                expect(await staking.availableBalanceOf(TRANCHE_B, addr1)).to.equal(78900);
            });

            it("Zero targetVersion", async function () {
                await fund.mock.getConversionSize.returns(2);
                await fund.mock.getConversionTimestamp.withArgs(0).returns(checkpointTimestamp + 1);
                await fund.mock.getConversionTimestamp.withArgs(1).returns(checkpointTimestamp + 2);
                await advanceBlockAtTime(checkpointTimestamp + 100);
                await expect(() => staking.refreshBalance(addr1, 0)).to.callMocks(
                    {
                        func: fund.mock.convert.withArgs(TOTAL_P, TOTAL_A, TOTAL_B, 0),
                        rets: [10000, 1000, 100],
                    },
                    {
                        func: fund.mock.convert.withArgs(10000, 1000, 100, 1),
                        rets: [20000, 2000, 200],
                    },
                    {
                        func: fund.mock.convert.withArgs(USER1_P, USER1_A, USER1_B, 0),
                        rets: [123, 456, 789],
                    },
                    {
                        func: fund.mock.convert.withArgs(123, 456, 789, 1),
                        rets: [1230, 4560, 7890],
                    }
                );
                expect(await staking.balanceVersion(addr1)).to.equal(2);
                expect(await staking.availableBalanceOf(TRANCHE_P, addr1)).to.equal(1230);
                expect(await staking.availableBalanceOf(TRANCHE_A, addr1)).to.equal(4560);
                expect(await staking.availableBalanceOf(TRANCHE_B, addr1)).to.equal(7890);
            });

            it("Should make no change if targetVersion is older", async function () {
                await fund.mock.getConversionSize.returns(2);
                await fund.mock.getConversionTimestamp.withArgs(0).returns(checkpointTimestamp + 1);
                await fund.mock.getConversionTimestamp.withArgs(1).returns(checkpointTimestamp + 2);
                await advanceBlockAtTime(checkpointTimestamp + 100);
                await expect(() => staking.refreshBalance(addr1, 2)).to.callMocks(
                    {
                        func: fund.mock.convert.withArgs(TOTAL_P, TOTAL_A, TOTAL_B, 0),
                        rets: [10000, 1000, 100],
                    },
                    {
                        func: fund.mock.convert.withArgs(10000, 1000, 100, 1),
                        rets: [20000, 2000, 200],
                    },
                    {
                        func: fund.mock.convert.withArgs(USER1_P, USER1_A, USER1_B, 0),
                        rets: [123, 456, 789],
                    },
                    {
                        func: fund.mock.convert.withArgs(123, 456, 789, 1),
                        rets: [1230, 4560, 7890],
                    }
                );

                await staking.refreshBalance(addr1, 1);
                expect(await staking.availableBalanceOf(TRANCHE_P, addr1)).to.equal(1230);
                expect(await staking.availableBalanceOf(TRANCHE_A, addr1)).to.equal(4560);
                expect(await staking.availableBalanceOf(TRANCHE_B, addr1)).to.equal(7890);
            });

            it("Should convert both available and locked balance", async function () {
                await staking.lock(TRANCHE_P, addr1, 1000);
                await staking.lock(TRANCHE_A, addr1, 100);
                await staking.lock(TRANCHE_B, addr1, 10);
                await fund.mock.getConversionSize.returns(1);

                await fund.mock.getConversionTimestamp
                    .withArgs(0)
                    .returns((await ethers.provider.getBlock("latest")).timestamp - 1);
                await advanceBlockAtTime(checkpointTimestamp + 100);
                await expect(() => staking.refreshBalance(addr1, 1)).to.callMocks(
                    {
                        func: fund.mock.convert.withArgs(TOTAL_P, TOTAL_A, TOTAL_B, 0),
                        rets: [10000, 1000, 100],
                    },
                    {
                        func: fund.mock.convert.withArgs(
                            USER1_P.sub(1000),
                            USER1_A.sub(100),
                            USER1_B.sub(10),
                            0
                        ),
                        rets: [123, 456, 789],
                    },
                    {
                        func: fund.mock.convert.withArgs(1000, 100, 10, 0),
                        rets: [12, 34, 56],
                    }
                );
                expect(await staking.availableBalanceOf(TRANCHE_P, addr1)).to.equal(123);
                expect(await staking.availableBalanceOf(TRANCHE_A, addr1)).to.equal(456);
                expect(await staking.availableBalanceOf(TRANCHE_B, addr1)).to.equal(789);
                expect(await staking.lockedBalanceOf(TRANCHE_P, addr1)).to.equal(12);
                expect(await staking.lockedBalanceOf(TRANCHE_A, addr1)).to.equal(34);
                expect(await staking.lockedBalanceOf(TRANCHE_B, addr1)).to.equal(56);
            });

            it("Should convert zero balance", async function () {
                await fund.mock.getConversionSize.returns(1);
                await fund.mock.getConversionTimestamp.withArgs(0).returns(checkpointTimestamp + 1);
                await advanceBlockAtTime(checkpointTimestamp + 100);
                await expect(() => staking.refreshBalance(owner.address, 1)).to.callMocks({
                    func: fund.mock.convert.withArgs(TOTAL_P, TOTAL_A, TOTAL_B, 0),
                    rets: [10000, 1000, 100],
                });
                expect(await staking.availableBalanceOf(TRANCHE_P, owner.address)).to.equal(0);
                expect(await staking.availableBalanceOf(TRANCHE_A, owner.address)).to.equal(0);
                expect(await staking.availableBalanceOf(TRANCHE_B, owner.address)).to.equal(0);
                expect(await staking.lockedBalanceOf(TRANCHE_P, owner.address)).to.equal(0);
                expect(await staking.lockedBalanceOf(TRANCHE_A, owner.address)).to.equal(0);
                expect(await staking.lockedBalanceOf(TRANCHE_B, owner.address)).to.equal(0);
            });

            it("Should revert on out-of-bound target version", async function () {
                await fund.mock.getConversionSize.returns(1);
                await expect(staking.refreshBalance(addr1, 2)).to.be.revertedWith(
                    "Target version out of bound"
                );
            });
        });

        describe("convertAndClearTrade()", function () {
            it("Should convert trade before clearing it", async function () {
                await fund.mock.getConversionSize.returns(1);
                await fund.mock.getConversionTimestamp.withArgs(0).returns(checkpointTimestamp + 1);
                await fund.mock.convert
                    .withArgs(TOTAL_P, TOTAL_A, TOTAL_B, 0)
                    .returns(10000, 1000, 100);
                await fund.mock.convert
                    .withArgs(USER1_P, USER1_A, USER1_B, 0)
                    .returns(8000, 800, 80);
                await fund.mock.batchConvert.withArgs(1230, 4560, 7890, 0, 1).returns(123, 45, 0);
                await staking.convertAndClearTrade(addr1, 1230, 4560, 7890, 0);
                expect(await staking.availableBalanceOf(TRANCHE_P, addr1)).to.equal(8123);
                expect(await staking.availableBalanceOf(TRANCHE_A, addr1)).to.equal(845);
                expect(await staking.availableBalanceOf(TRANCHE_B, addr1)).to.equal(80);
            });
        });

        describe("convertAndUnlock()", function () {
            it("Should convert order amounts before unlock", async function () {
                await staking.lock(TRANCHE_A, addr1, 3000);
                await fund.mock.getConversionSize.returns(1);
                await fund.mock.getConversionTimestamp
                    .withArgs(0)
                    .returns((await ethers.provider.getBlock("latest")).timestamp - 1);
                await fund.mock.convert
                    .withArgs(TOTAL_P, TOTAL_A, TOTAL_B, 0)
                    .returns(10000, 1000, 100);
                await fund.mock.convert
                    .withArgs(USER1_P, USER1_A.sub(3000), USER1_B, 0)
                    .returns(8000, 800, 80);
                await fund.mock.convert.withArgs(0, 3000, 0, 0).returns(900, 90, 0);
                await fund.mock.batchConvert.withArgs(0, 2000, 0, 0, 1).returns(600, 60, 0);
                await staking.convertAndUnlock(addr1, 0, 2000, 0, 0);
                expect(await staking.availableBalanceOf(TRANCHE_P, addr1)).to.equal(8600);
                expect(await staking.availableBalanceOf(TRANCHE_A, addr1)).to.equal(860);
                expect(await staking.availableBalanceOf(TRANCHE_B, addr1)).to.equal(80);
                expect(await staking.lockedBalanceOf(TRANCHE_P, addr1)).to.equal(300);
                expect(await staking.lockedBalanceOf(TRANCHE_A, addr1)).to.equal(30);
                expect(await staking.lockedBalanceOf(TRANCHE_B, addr1)).to.equal(0);
            });
        });
    });

    describe("Rewards", function () {
        let rate1: BigNumber;
        let rate2: BigNumber;

        /**
         * Return claimable rewards of both user at time `claimingTime` if user1's balance
         * increases at `doublingTime` by a certain amount such that the total reward weight
         * doubles.
         */
        function rewardsAfterDoublingTotal(
            doublingTime: number,
            claimingTime: number
        ): { rewards1: BigNumber; rewards2: BigNumber } {
            const formerRewards1 = rate1.mul(doublingTime);
            // User1 rewards between doublingTime and claimingTime
            // `rate1 * (claimingTime - doublingTime) / 2` for the origin balance, plus
            // half of the total rewards in this period for the increased balance
            const latterRewards1 = rate1
                .div(2)
                .add(parseEther("0.5"))
                .mul(claimingTime - doublingTime);
            const rewards1 = formerRewards1.add(latterRewards1);
            const rewards2 = parseEther("1").mul(claimingTime).sub(rewards1);
            return { rewards1, rewards2 };
        }

        /*
         * Return claimable rewards of both user at time `claimingTime` if user1's balance
         * decreases at `doublingTime` by a certain amount such that the total reward weight
         * reduces to 80%.
         */
        function rewardsAfterReducingTotal(
            doublingTime: number,
            claimingTime: number
        ): { rewards1: BigNumber; rewards2: BigNumber } {
            const formerRewards2 = rate2.mul(doublingTime);
            // original rewards / 80%
            const latterRewards2 = rate2
                .mul(claimingTime - doublingTime)
                .mul(5)
                .div(4);
            const rewards2 = formerRewards2.add(latterRewards2);
            const rewards1 = parseEther("1").mul(claimingTime).sub(rewards2);
            return { rewards1, rewards2 };
        }

        beforeEach(async function () {
            // Trigger a checkpoint and record its block timestamp. Reward rate is zero before
            // this checkpoint. So no one has rewards till now.
            await fund.mock.getConversionTimestamp.withArgs(0).returns(nextEpoch + 100 * WEEK);
            await chess.set(nextEpoch + 100 * WEEK, parseEther("1"));
            advanceBlockAtTime(nextEpoch);

            checkpointTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
            rate1 = parseEther("1").mul(USER1_WEIGHT).div(TOTAL_WEIGHT);
            rate2 = parseEther("1").mul(USER2_WEIGHT).div(TOTAL_WEIGHT);
        });

        it("Should mint rewards on claimRewards()", async function () {
            await advanceBlockAtTime(checkpointTimestamp + 100);
            expect(await staking.callStatic["claimableRewards"](addr1)).to.equal(rate1.mul(100));
            expect(await staking.callStatic["claimableRewards"](addr2)).to.equal(rate2.mul(100));

            await setNextBlockTime(checkpointTimestamp + 300);
            await expect(() => staking.claimRewards(addr1)).to.changeTokenBalance(
                chess,
                user1,
                rate1.mul(300)
            );

            await advanceBlockAtTime(checkpointTimestamp + 800);
            expect(await staking.callStatic["claimableRewards"](addr1)).to.equal(rate1.mul(500));
            expect(await staking.callStatic["claimableRewards"](addr2)).to.equal(rate2.mul(800));

            await setNextBlockTime(checkpointTimestamp + 1000);
            await expect(() => staking.claimRewards(addr1)).to.changeTokenBalance(
                chess,
                user1,
                rate1.mul(700)
            );
        });

        it("Should make a checkpoint on deposit()", async function () {
            // Deposit some Share A to double the total reward weight
            await shareA.mock.transferFrom.returns(true);
            await setNextBlockTime(checkpointTimestamp + 100);
            await staking.deposit(
                TRANCHE_A,
                TOTAL_WEIGHT.mul(REWARD_WEIGHT_P).div(REWARD_WEIGHT_A)
            );

            await advanceBlockAtTime(checkpointTimestamp + 500);
            const { rewards1, rewards2 } = rewardsAfterDoublingTotal(100, 500);
            expect(await staking.callStatic["claimableRewards"](addr1)).to.equal(rewards1);
            expect(await staking.callStatic["claimableRewards"](addr2)).to.equal(rewards2);
        });

        it("Should make a checkpoint on withdraw()", async function () {
            // Withdraw some Share P to reduce 20% of the total reward weight,
            // assuming balance is enough
            await shareP.mock.transfer.returns(true);
            await setNextBlockTime(checkpointTimestamp + 200);
            await staking.withdraw(TRANCHE_P, TOTAL_WEIGHT.div(5));

            await advanceBlockAtTime(checkpointTimestamp + 700);
            const { rewards1, rewards2 } = rewardsAfterReducingTotal(200, 700);
            expect(await staking.callStatic["claimableRewards"](addr1)).to.equal(rewards1);
            expect(await staking.callStatic["claimableRewards"](addr2)).to.equal(rewards2);
        });

        it("Should make a checkpoint on tradeAvailable()", async function () {
            // Trade some Share P to reduce 20% of the total reward weight, assuming balance is enough
            await shareP.mock.transfer.returns(true);
            await setNextBlockTime(checkpointTimestamp + 300);
            await staking.tradeAvailable(TRANCHE_P, addr1, TOTAL_WEIGHT.div(5));

            await advanceBlockAtTime(checkpointTimestamp + 900);
            const { rewards1, rewards2 } = rewardsAfterReducingTotal(300, 900);
            expect(await staking.callStatic["claimableRewards"](addr1)).to.equal(rewards1);
            expect(await staking.callStatic["claimableRewards"](addr2)).to.equal(rewards2);
        });

        it("Should make a checkpoint on convertAndClearTrade()", async function () {
            // Get some Share B by settling trade to double the total reward weight
            await shareA.mock.transferFrom.returns(true);
            await setNextBlockTime(checkpointTimestamp + 400);
            await staking.convertAndClearTrade(
                addr1,
                0,
                0,
                TOTAL_WEIGHT.mul(REWARD_WEIGHT_P).div(REWARD_WEIGHT_B),
                0
            );

            await advanceBlockAtTime(checkpointTimestamp + 1500);
            const { rewards1, rewards2 } = rewardsAfterDoublingTotal(400, 1500);
            expect(await staking.callStatic["claimableRewards"](addr1)).to.equal(rewards1);
            expect(await staking.callStatic["claimableRewards"](addr2)).to.equal(rewards2);
        });

        it("Should have no difference in rewarding available and locked balance", async function () {
            await setNextBlockTime(checkpointTimestamp + 300);
            await staking.lock(TRANCHE_P, addr1, USER1_P.div(2));
            await setNextBlockTime(checkpointTimestamp + 350);
            await staking.lock(TRANCHE_A, addr1, USER1_A.div(3));
            await setNextBlockTime(checkpointTimestamp + 400);
            await staking.lock(TRANCHE_B, addr2, USER2_B.div(4));

            await advanceBlockAtTime(checkpointTimestamp + 500);
            expect(await staking.callStatic["claimableRewards"](addr1)).to.equal(rate1.mul(500));
            expect(await staking.callStatic["claimableRewards"](addr2)).to.equal(rate2.mul(500));

            await setNextBlockTime(checkpointTimestamp + 700);
            await staking.convertAndUnlock(addr1, USER1_P.div(3), 0, 0, 0);
            await setNextBlockTime(checkpointTimestamp + 750);
            await staking.convertAndUnlock(addr1, 0, USER1_A.div(5), 0, 0);
            await setNextBlockTime(checkpointTimestamp + 800);
            await staking.convertAndUnlock(addr2, 0, 0, USER2_B.div(7), 0);

            await advanceBlockAtTime(checkpointTimestamp + 2000);
            expect(await staking.callStatic["claimableRewards"](addr1)).to.equal(rate1.mul(2000));
            expect(await staking.callStatic["claimableRewards"](addr2)).to.equal(rate2.mul(2000));
        });

        it("Should make a checkpoint on tradeLocked()", async function () {
            // Trade some locked Share P to reduce 20% of the total reward weight
            await shareP.mock.transfer.returns(true);
            await setNextBlockTime(checkpointTimestamp + 789);
            await staking.lock(TRANCHE_P, addr1, USER1_P);
            await setNextBlockTime(checkpointTimestamp + 1234);
            await staking.tradeLocked(TRANCHE_P, addr1, TOTAL_WEIGHT.div(5));

            await advanceBlockAtTime(checkpointTimestamp + 5678);
            const { rewards1, rewards2 } = rewardsAfterReducingTotal(1234, 5678);
            expect(await staking.callStatic["claimableRewards"](addr1)).to.equal(rewards1);
            expect(await staking.callStatic["claimableRewards"](addr2)).to.equal(rewards2);
        });

        it("Should handle multiple checkpoints in the same block correctly", async function () {
            // Deposit some Share A to double the total reward weight, in three transactions
            const totalDeposit = TOTAL_WEIGHT.mul(REWARD_WEIGHT_P).div(REWARD_WEIGHT_A);
            const deposit1 = totalDeposit.div(4);
            const deposit2 = totalDeposit.div(3);
            const deposit3 = totalDeposit.sub(deposit1).sub(deposit2);
            await shareA.mock.transferFrom.returns(true);
            await setAutomine(false);
            await staking.deposit(TRANCHE_A, deposit1);
            await staking.deposit(TRANCHE_A, deposit2);
            await staking.deposit(TRANCHE_A, deposit3);
            await advanceBlockAtTime(checkpointTimestamp + 100);
            await setAutomine(true);

            await advanceBlockAtTime(checkpointTimestamp + 500);
            const { rewards1, rewards2 } = rewardsAfterDoublingTotal(100, 500);
            expect(await staking.callStatic["claimableRewards"](addr1)).to.equal(rewards1);
            expect(await staking.callStatic["claimableRewards"](addr2)).to.equal(rewards2);
        });

        it("Should calculate rewards after each conversion", async function () {
            await fund.mock.getConversionSize.returns(2);
            await fund.mock.getConversionTimestamp.withArgs(0).returns(checkpointTimestamp + 100);
            await fund.mock.getConversionTimestamp.withArgs(1).returns(checkpointTimestamp + 400);
            await fund.mock.convert
                .withArgs(TOTAL_P, TOTAL_A, TOTAL_B, 0)
                .returns(TOTAL_P.mul(4), TOTAL_A.mul(4), TOTAL_B.mul(4));
            await fund.mock.convert
                .withArgs(TOTAL_P.mul(4), TOTAL_A.mul(4), TOTAL_B.mul(4), 1)
                .returns(TOTAL_P.mul(15), TOTAL_A.mul(15), TOTAL_B.mul(15));
            await fund.mock.convert
                .withArgs(USER1_P, USER1_A, USER1_B, 0)
                .returns(USER1_P.mul(2), USER1_A.mul(2), USER1_B.mul(2));
            await fund.mock.convert
                .withArgs(USER1_P.mul(2), USER1_A.mul(2), USER1_B.mul(2), 1)
                .returns(USER1_P.mul(3), USER1_A.mul(3), USER1_B.mul(3));
            await advanceBlockAtTime(checkpointTimestamp + 1000);

            const rewardVersion0 = rate1.mul(100);
            const rewardVersion1 = rate1.div(2).mul(300); // Half (2/4) rate1 after the first conversion
            const rewardVersion2 = rate1.div(5).mul(600); // One-fifth (3/15) rate1 after the first conversion
            const expectedRewards = rewardVersion0.add(rewardVersion1).add(rewardVersion2);
            expect(await staking.callStatic["claimableRewards"](addr1)).to.equal(expectedRewards);
        });

        it("Should be able to handle zero total supplies between two conversions", async function () {
            // Withdraw all P and A shares (in a single block to make rewards calculation easy)
            await shareP.mock.transfer.returns(true);
            await shareA.mock.transfer.returns(true);
            await shareP.mock.transferFrom.returns(true);
            await setAutomine(false);
            await staking.withdraw(TRANCHE_P, USER1_P);
            await staking.withdraw(TRANCHE_A, USER1_A);
            await staking.connect(user2).withdraw(TRANCHE_P, USER2_P);
            await staking.connect(user2).withdraw(TRANCHE_A, USER2_A);
            await advanceBlockAtTime(checkpointTimestamp + 100);
            await setAutomine(true);
            // Rewards before the withdrawals
            let user1Rewards = rate1.mul(100);
            let user2Rewards = rate2.mul(100);

            // Convert any B shares to zero in the first conversion.
            await fund.mock.getConversionSize.returns(2);
            await fund.mock.getConversionTimestamp.withArgs(0).returns(checkpointTimestamp + 400);
            await fund.mock.getConversionTimestamp.withArgs(1).returns(checkpointTimestamp + 1000);
            await fund.mock.convert.withArgs(0, 0, TOTAL_B, 0).returns(0, 0, 0);
            await fund.mock.convert.withArgs(0, 0, USER1_B, 0).returns(0, 0, 0);
            await fund.mock.convert.withArgs(0, 0, USER2_B, 0).returns(0, 0, 0);
            await fund.mock.convert.withArgs(0, 0, 0, 1).returns(0, 0, 0);
            // Add rewards till the first conversion
            user1Rewards = user1Rewards.add(parseEther("1").mul(300).mul(USER1_B).div(TOTAL_B));
            user2Rewards = user2Rewards.add(parseEther("1").mul(300).mul(USER2_B).div(TOTAL_B));

            // User1 deposit some P shares
            await setNextBlockTime(checkpointTimestamp + 2000);
            await staking.deposit(TRANCHE_P, parseEther("1"));

            // User2 deposit some P shares
            await setNextBlockTime(checkpointTimestamp + 3500);
            await staking.connect(user2).deposit(TRANCHE_P, parseEther("1"));
            // Add rewards before user2's deposit
            user1Rewards = user1Rewards.add(parseEther("1").mul(1500));

            await advanceBlockAtTime(checkpointTimestamp + 5600);
            // The two users evenly split rewards after user2's deposit
            user1Rewards = user1Rewards.add(parseEther("0.5").mul(2100));
            user2Rewards = user2Rewards.add(parseEther("0.5").mul(2100));
            expect(await staking.callStatic["claimableRewards"](addr1)).to.equal(user1Rewards);
            expect(await staking.callStatic["claimableRewards"](addr2)).to.equal(user2Rewards);
        });
    });
});
