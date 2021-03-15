import { expect } from "chai";
import { Contract, Wallet } from "ethers";
import type { Fixture, MockContract, MockProvider } from "ethereum-waffle";
import { waffle, ethers } from "hardhat";
const { loadFixture } = waffle;
const { parseEther } = ethers.utils;
import { deployMockForName } from "./mock";

const TRANCHE_P = 0;
const TRANCHE_A = 1;
const TRANCHE_B = 2;
const REWARD_WEIGHT_A = 1;
const REWARD_WEIGHT_B = 3;
const REWARD_WEIGHT_P = 4;
const USER1_P = parseEther("10000");
const USER1_A = parseEther("1000");
const USER1_B = parseEther("100");
const USER2_P = parseEther("2000");
const USER2_A = parseEther("200");
const USER2_B = parseEther("20");
const TOTAL_P = USER1_P.add(USER2_P);
const TOTAL_A = USER1_A.add(USER2_A);
const TOTAL_B = USER1_B.add(USER2_B);

describe("Staking", function () {
    interface FixtureWalletMap {
        readonly [name: string]: Wallet;
    }

    interface FixtureData {
        readonly wallets: FixtureWalletMap;
        readonly fund: MockContract;
        readonly shareP: MockContract;
        readonly shareA: MockContract;
        readonly shareB: MockContract;
        readonly chess: MockContract;
        readonly chessController: MockContract;
        readonly usdc: Contract;
        readonly staking: Contract;
    }

    let currentFixture: Fixture<FixtureData>;
    let fixtureData: FixtureData;

    let user1: Wallet;
    let user2: Wallet;
    let owner: Wallet;
    let addr1: string;
    let fund: MockContract;
    let shareP: MockContract;
    let shareA: MockContract;
    let shareB: MockContract;
    let chess: MockContract;
    let chessController: MockContract;
    let usdc: Contract;
    let staking: Contract;

    async function deployFixture(_wallets: Wallet[], provider: MockProvider): Promise<FixtureData> {
        const [user1, user2, owner] = provider.getWallets();

        const fund = await deployMockForName(owner, "IFund");
        const shareP = await deployMockForName(owner, "IERC20");
        const shareA = await deployMockForName(owner, "IERC20");
        const shareB = await deployMockForName(owner, "IERC20");
        await fund.mock.tokenP.returns(shareP.address);
        await fund.mock.tokenA.returns(shareA.address);
        await fund.mock.tokenB.returns(shareB.address);
        await fund.mock.getConversionSize.returns(0);

        const chess = await deployMockForName(owner, "IChess");
        await chess.mock.rate.returns(0);

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
        await shareP.mock.transferFrom.revertsWithReason("Mock on the method is not initialized");
        await shareA.mock.transferFrom.revertsWithReason("Mock on the method is not initialized");
        await shareB.mock.transferFrom.revertsWithReason("Mock on the method is not initialized");

        return {
            wallets: { user1, user2, owner },
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
        user1 = fixtureData.wallets.user1;
        user2 = fixtureData.wallets.user2;
        owner = fixtureData.wallets.owner;
        addr1 = user1.address;
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

    describe("Rewards", function () {
        //
    });

    describe("Conversion", function () {
        //
    });
});
