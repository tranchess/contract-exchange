// SPDX-License-Identifier: MIT
pragma solidity 0.6.9;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IFund.sol";

interface IExchange {
    function isMaker(address account) external view returns (bool);

    function availableBalanceOf(uint256 tranche, address account) external view returns (uint256);

    function lockedBalanceOf(uint256 tranche, address account) external view returns (uint256);
}

contract AccountData {
    uint256 public constant TRANCHE_P = 0;
    uint256 public constant TRANCHE_A = 1;
    uint256 public constant TRANCHE_B = 2;

    struct Shares {
        uint256 trancheP;
        uint256 trancheA;
        uint256 trancheB;
    }

    struct ExchangeData {
        Shares staked;
        Shares locked;
        bool maker;
        uint256 reward;
    }

    struct AccountDetails {
        Shares circulating;
        uint256 underlying;
        uint256 quote;
        uint256 chess;
    }

    function getAccountExchangeData(address exchange, address account)
        external
        view
        returns (ExchangeData memory exchangeData)
    {
        exchangeData.staked = Shares({
            trancheP: IExchange(exchange).availableBalanceOf(TRANCHE_P, account),
            trancheA: IExchange(exchange).availableBalanceOf(TRANCHE_A, account),
            trancheB: IExchange(exchange).availableBalanceOf(TRANCHE_B, account)
        });
        exchangeData.locked = Shares({
            trancheP: IExchange(exchange).lockedBalanceOf(TRANCHE_P, account),
            trancheA: IExchange(exchange).lockedBalanceOf(TRANCHE_A, account),
            trancheB: IExchange(exchange).lockedBalanceOf(TRANCHE_B, account)
        });
        exchangeData.maker = IExchange(exchange).isMaker(account);
        (, bytes memory res) =
            exchange.staticcall(abi.encodePacked("claimableRewards(address)", account));
        exchangeData.reward = abi.decode(res, (uint256));
    }

    function getAccountDetails(
        address fund,
        address quoteAssetAddress,
        address chess,
        address account
    ) external view returns (AccountDetails memory accountDetails) {
        accountDetails.circulating = Shares({
            trancheP: IFund(fund).shareBalanceOf(TRANCHE_P, account),
            trancheA: IFund(fund).shareBalanceOf(TRANCHE_A, account),
            trancheB: IFund(fund).shareBalanceOf(TRANCHE_B, account)
        });
        accountDetails.underlying = IERC20(IFund(fund).tokenUnderlying()).balanceOf(account);
        accountDetails.quote = IERC20(quoteAssetAddress).balanceOf(account);
        accountDetails.chess = IERC20(chess).balanceOf(account);
    }
}
