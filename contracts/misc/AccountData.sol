// SPDX-License-Identifier: MIT
pragma solidity 0.6.9;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IFund.sol";
import "../interfaces/ITrancheIndex.sol";

interface IExchange {
    function isMaker(address account) external view returns (bool);

    function availableBalanceOf(uint256 tranche, address account) external view returns (uint256);

    function lockedBalanceOf(uint256 tranche, address account) external view returns (uint256);

    function claimableRewards(address account) external returns (uint256);
}

contract AccountData is ITrancheIndex {
    struct Shares {
        uint256 p;
        uint256 a;
        uint256 b;
    }

    struct ExchangeData {
        Shares available;
        Shares locked;
        bool isMaker;
        uint256 reward;
    }

    struct AccountDetails {
        Shares circulating;
        uint256 underlying;
        uint256 quote;
        uint256 chess;
    }

    /// @dev This function should be call as a "view" function off-chain to get the return value,
    ///      e.g. using `contract.getAccountExchangeData.call(exchangeAddress, account)` in web3
    ///      or `contract.callStatic["getAccountExchangeData"](exchangeAddress, account)` in ethers.js.
    function getAccountExchangeData(address exchangeAddress, address account)
        external
        returns (ExchangeData memory exchangeData)
    {
        IExchange exchange = IExchange(exchangeAddress);
        exchangeData.available.p = exchange.availableBalanceOf(TRANCHE_P, account);
        exchangeData.available.a = exchange.availableBalanceOf(TRANCHE_A, account);
        exchangeData.available.b = exchange.availableBalanceOf(TRANCHE_B, account);
        exchangeData.locked.p = exchange.lockedBalanceOf(TRANCHE_P, account);
        exchangeData.locked.a = exchange.lockedBalanceOf(TRANCHE_A, account);
        exchangeData.locked.b = exchange.lockedBalanceOf(TRANCHE_B, account);
        exchangeData.isMaker = exchange.isMaker(account);
        exchangeData.reward = exchange.claimableRewards(account);
    }

    function getAccountDetails(
        address fund,
        address quoteAssetAddress,
        address chess,
        address account
    ) external view returns (AccountDetails memory accountDetails) {
        (
            accountDetails.circulating.p,
            accountDetails.circulating.a,
            accountDetails.circulating.b
        ) = IFund(fund).allShareBalanceOf(account);

        accountDetails.underlying = IERC20(IFund(fund).tokenUnderlying()).balanceOf(account);
        accountDetails.quote = IERC20(quoteAssetAddress).balanceOf(account);
        accountDetails.chess = IERC20(chess).balanceOf(account);
    }
}
