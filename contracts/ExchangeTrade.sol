// SPDX-License-Identifier: MIT
pragma solidity ^0.6.9;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";

/// @title Tranchess's Pending Trade Contract
/// @notice Pending trade struct and implementation
/// @author Tranchess
contract ExchangeTrade {
    using SafeMath for uint256;

    /// @notice Pending trades of an account
    struct PendingTrade {
        PendingBuyTrade takerBuy; // Buy trades as taker
        PendingSellTrade takerSell; // Sell trades as taker
        PendingSellTrade makerBuy; // Buy trades as maker
        PendingBuyTrade makerSell; // Sell trades as maker
    }

    struct PendingBuyTrade {
        uint256 frozenQuote; // Amount of quote assets frozen for settlement
        uint256 effectiveQuote; // Amount of quote assets in effect
        uint256 reservedBase; // Amount of base assets spent
    }

    struct PendingSellTrade {
        uint256 frozenBase; // Amount of base assets frozen for settlement
        uint256 effectiveBase; // Amount of base assets in effect
        uint256 reservedQuote; // Amount of quote assets spent
    }

    /// @notice Accumulate buy trades
    /// @param tradeA First buy trade
    /// @param tradeB Second buy trade
    /// @return The summation of the tradeA and tradeB
    function _addBuyTrade(PendingBuyTrade memory tradeA, PendingBuyTrade memory tradeB)
        internal
        pure
        returns (PendingBuyTrade memory)
    {
        return
            PendingBuyTrade({
                frozenQuote: tradeA.frozenQuote.add(tradeB.frozenQuote),
                effectiveQuote: tradeA.effectiveQuote.add(tradeB.effectiveQuote),
                reservedBase: tradeA.reservedBase.add(tradeB.reservedBase)
            });
    }

    /// @notice Accumulate sell trades
    /// @param tradeA First sell trade
    /// @param tradeB Second sell trade
    /// @return Summation of the tradeA and tradeB
    function _addSellTrade(PendingSellTrade memory tradeA, PendingSellTrade memory tradeB)
        internal
        pure
        returns (PendingSellTrade memory)
    {
        return
            PendingSellTrade({
                frozenBase: tradeA.frozenBase.add(tradeB.frozenBase),
                effectiveBase: tradeA.effectiveBase.add(tradeB.effectiveBase),
                reservedQuote: tradeA.reservedQuote.add(tradeB.reservedQuote)
            });
    }
}
