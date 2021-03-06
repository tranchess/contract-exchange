// SPDX-License-Identifier: MIT
pragma solidity >=0.6.10 <0.8.0;
pragma experimental ABIEncoderV2;

import "./utils/SafeDecimalMath.sol";

import {Order, OrderQueue, LibOrderQueue} from "./libs/LibOrderQueue.sol";
import {
    PendingBuyTrade,
    PendingSellTrade,
    PendingTrade,
    LibPendingBuyTrade,
    LibPendingSellTrade
} from "./libs/LibPendingTrade.sol";

import "./ExchangeRoles.sol";
import "./Staking.sol";

/// @title Tranchess's Exchange Contract
/// @notice A decentralized exchange to match premium-discount orders and clear trades
/// @author Tranchess
contract Exchange is ExchangeRoles, Staking {
    using SafeDecimalMath for uint256;
    using LibOrderQueue for OrderQueue;
    using LibPendingBuyTrade for PendingBuyTrade;
    using LibPendingSellTrade for PendingSellTrade;

    /// @notice Identifier of a pending order
    struct OrderIdentifier {
        uint256 pdLevel; // Premium-discount level
        uint256 index; // Order queue index
    }

    /// @notice A maker bid order is placed.
    /// @param maker Account placing the order
    /// @param tranche Tranche of the share to buy
    /// @param pdLevel Premium-discount level
    /// @param quoteAmount Amount of quote asset in the order, rounding precision to 18
    ///                    for quote assets with precision other than 18 decimal places
    /// @param conversionID The latest conversion ID when the order is placed
    /// @param clientOrderID Order ID specified by user
    /// @param orderIndex Index of the order in the order queue
    event BidOrderPlaced(
        address indexed maker,
        uint256 indexed tranche,
        uint256 pdLevel,
        uint256 quoteAmount,
        uint256 conversionID,
        uint256 clientOrderID,
        uint256 orderIndex
    );

    /// @notice A maker ask order is placed.
    /// @param maker Account placing the order
    /// @param tranche Tranche of the share to sell
    /// @param pdLevel Premium-discount level
    /// @param baseAmount Amount of base asset in the order
    /// @param conversionID The latest conversion ID when the order is placed
    /// @param clientOrderID Order ID specified by user
    /// @param orderIndex Index of the order in the order queue
    event AskOrderPlaced(
        address indexed maker,
        uint256 indexed tranche,
        uint256 pdLevel,
        uint256 baseAmount,
        uint256 conversionID,
        uint256 clientOrderID,
        uint256 orderIndex
    );

    /// @notice A maker bid order is canceled.
    /// @param maker Account placing the order
    /// @param tranche Tranche of the share
    /// @param pdLevel Premium-discount level
    /// @param quoteAmount Original amount of quote asset in the order, rounding precision to 18
    ///                    for quote assets with precision other than 18 decimal places
    /// @param conversionID The latest conversion ID when the order is placed
    /// @param orderIndex Index of the order in the order queue
    /// @param fillable Unfilled amount when the order is canceled, rounding precision to 18 for
    ///                 quote assets with precision other than 18 decimal places
    event BidOrderCanceled(
        address indexed maker,
        uint256 indexed tranche,
        uint256 pdLevel,
        uint256 quoteAmount,
        uint256 conversionID,
        uint256 orderIndex,
        uint256 fillable
    );

    /// @notice A maker ask order is canceled.
    /// @param maker Account placing the order
    /// @param tranche Tranche of the share to sell
    /// @param pdLevel Premium-discount level
    /// @param baseAmount Original amount of base asset in the order
    /// @param conversionID The latest conversion ID when the order is placed
    /// @param orderIndex Index of the order in the order queue
    /// @param fillable Unfilled amount when the order is canceled
    event AskOrderCanceled(
        address indexed maker,
        uint256 indexed tranche,
        uint256 pdLevel,
        uint256 baseAmount,
        uint256 conversionID,
        uint256 orderIndex,
        uint256 fillable
    );

    /// @notice Matching result of a taker bid order.
    /// @param taker Account placing the order
    /// @param tranche Tranche of the share
    /// @param quoteAmount Matched amount of quote asset, rounding precision to 18 for quote assets
    ///                    with precision other than 18 decimal places
    /// @param conversionID Conversion ID of this trade
    /// @param lastMatchedPDLevel Premium-discount level of the last matched maker order
    /// @param lastMatchedOrderIndex Index of the last matched maker order in its order queue
    /// @param lastMatchedBaseAmount Matched base asset amount of the last matched maker order
    event BuyTrade(
        address indexed taker,
        uint256 indexed tranche,
        uint256 quoteAmount,
        uint256 conversionID,
        uint256 lastMatchedPDLevel,
        uint256 lastMatchedOrderIndex,
        uint256 lastMatchedBaseAmount
    );

    /// @notice Matching result of a taker ask order.
    /// @param taker Account placing the order
    /// @param tranche Tranche of the share
    /// @param baseAmount Matched amount of base asset
    /// @param conversionID Conversion ID of this trade
    /// @param lastMatchedPDLevel Premium-discount level of the last matched maker order
    /// @param lastMatchedOrderIndex Index of the last matched maker order in its order queue
    /// @param lastMatchedQuoteAmount Matched quote asset amount of the last matched maker order,
    ///                               rounding precision to 18 for quote assets with precision
    ///                               other than 18 decimal places
    event SellTrade(
        address indexed taker,
        uint256 indexed tranche,
        uint256 baseAmount,
        uint256 conversionID,
        uint256 lastMatchedPDLevel,
        uint256 lastMatchedOrderIndex,
        uint256 lastMatchedQuoteAmount
    );

    /// @notice Settlement of pending trades of maker orders.
    /// @param account Account placing the related maker orders
    /// @param epoch Epoch of the settled trades
    /// @param amountP Amount of Share P added to the account's available balance
    /// @param amountA Amount of Share A added to the account's available balance
    /// @param amountB Amount of Share B added to the account's available balance
    /// @param quoteAmount Amount of quote asset transfered to the account, rounding precision to 18
    ///                    for quote assets with precision other than 18 decimal places
    event MakerSettled(
        address indexed account,
        uint256 epoch,
        uint256 amountP,
        uint256 amountA,
        uint256 amountB,
        uint256 quoteAmount
    );

    /// @notice Settlement of pending trades of taker orders.
    /// @param account Account placing the related taker orders
    /// @param epoch Epoch of the settled trades
    /// @param amountP Amount of Share P added to the account's available balance
    /// @param amountA Amount of Share A added to the account's available balance
    /// @param amountB Amount of Share B added to the account's available balance
    /// @param quoteAmount Amount of quote asset transfered to the account, rounding precision to 18
    ///                    for quote assets with precision other than 18 decimal places
    event TakerSettled(
        address indexed account,
        uint256 epoch,
        uint256 amountP,
        uint256 amountA,
        uint256 amountB,
        uint256 quoteAmount
    );

    uint256 private constant EPOCH = 30 minutes; // An exchange epoch is 30 minutes long

    /// @dev Maker reserves 110% of the asset they want to trade, which would stop
    ///      losses for makers when the net asset values turn out volatile
    uint256 private constant MAKER_RESERVE_RATIO = 1.1e18;

    /// @dev Premium-discount level ranges from -10% to 10% with 0.25% as step size
    uint256 private constant PD_TICK = 0.0025e18;

    uint256 private constant MIN_PD = 0.9e18;
    uint256 private constant MAX_PD = 1.1e18;
    uint256 private constant PD_START = MIN_PD - PD_TICK;
    uint256 private constant PD_LEVEL_COUNT = (MAX_PD - MIN_PD) / PD_TICK + 1;

    /// @notice Minumum quote amount of maker bid orders with 18 decimal places
    uint256 public immutable minBidAmount;

    /// @notice Minumum base amount of maker ask orders
    uint256 public immutable minAskAmount;

    /// @dev A multipler that normalizes a quote asset balance to 18 decimal places.
    uint256 private immutable _quoteDecimalMultiplier;

    /// @notice Mapping of conversion ID => tranche => account => self-assigned order ID => order identifier
    mapping(uint256 => mapping(uint256 => mapping(address => mapping(uint256 => OrderIdentifier))))
        public identifiers;

    /// @notice Mapping of conversion ID => tranche => an array of order queues
    mapping(uint256 => mapping(uint256 => OrderQueue[PD_LEVEL_COUNT + 1])) public bids;
    mapping(uint256 => mapping(uint256 => OrderQueue[PD_LEVEL_COUNT + 1])) public asks;

    /// @notice Mapping of conversion ID => best bid premium-discount level of the three tranches.
    ///         Zero indicates that there is no bid order.
    mapping(uint256 => uint256[TRANCHE_COUNT]) public bestBids;

    /// @notice Mapping of conversion ID => best ask premium-discount level of the three tranches.
    ///         Zero or `PD_LEVEL_COUNT + 1` indicates that there is no ask order.
    mapping(uint256 => uint256[TRANCHE_COUNT]) public bestAsks;

    /// @notice Mapping of account => tranche => epoch ID => pending trade
    mapping(address => mapping(uint256 => mapping(uint256 => PendingTrade))) public pendingTrades;
    /// @notice Mapping of epoch ID => most recent conversion ID for pending trades
    mapping(uint256 => uint256) public mostRecentConversionPendingTrades;

    constructor(
        address fund_,
        address chess_,
        address chessController_,
        address quoteAssetAddress_,
        uint256 quoteDecimals_,
        address votingEscrow_,
        uint256 minBidAmount_,
        uint256 minAskAmount_,
        uint256 makerRequirement_
    )
        public
        ExchangeRoles(votingEscrow_, makerRequirement_)
        Staking(fund_, chess_, chessController_, quoteAssetAddress_)
    {
        minBidAmount = minBidAmount_;
        minAskAmount = minAskAmount_;
        require(quoteDecimals_ <= 18, "Quote asset decimals larger than 18");
        _quoteDecimalMultiplier = 10**(18 - quoteDecimals_);
    }

    /// @notice Return end timestamp of the epoch containing a given timestamp.
    /// @param timestamp Timestamp within a given epoch
    /// @return The closest ending timestamp
    function endOfEpoch(uint256 timestamp) public pure returns (uint256) {
        return (timestamp / EPOCH) * EPOCH + EPOCH;
    }

    function getBidOrder(
        uint256 conversionID,
        uint256 tranche,
        uint256 pdLevel,
        uint256 index
    )
        external
        view
        returns (
            address maker,
            uint256 amount,
            uint256 fillable
        )
    {
        Order storage order = bids[conversionID][tranche][pdLevel].list[index];
        maker = order.maker;
        amount = order.amount;
        fillable = order.fillable;
    }

    function getAskOrder(
        uint256 conversionID,
        uint256 tranche,
        uint256 pdLevel,
        uint256 index
    )
        external
        view
        returns (
            address maker,
            uint256 amount,
            uint256 fillable
        )
    {
        Order storage order = asks[conversionID][tranche][pdLevel].list[index];
        maker = order.maker;
        amount = order.amount;
        fillable = order.fillable;
    }

    /// @notice Get the order identifier
    /// @param conversionID Conversion ID when order was placed
    /// @param tranche Tranche of the base asset that the order is trading with
    /// @param account Maker address of the order
    /// @param clientOrderID Self-assigned order ID
    /// @return Identifier of the order
    function getOrderIdentifier(
        uint256 conversionID,
        uint256 tranche,
        address account,
        uint256 clientOrderID
    ) external view returns (OrderIdentifier memory) {
        return identifiers[conversionID][tranche][account][clientOrderID];
    }

    /// @notice Get all shares' net asset values of a given time
    /// @param timestamp Timestamp of the net asset value
    /// @return estimatedNavP Share P's net asset value
    /// @return estimatedNavA Share A's net asset value
    /// @return estimatedNavB Share B's net asset value
    function estimateNavs(uint256 timestamp)
        public
        view
        returns (
            uint256,
            uint256,
            uint256
        )
    {
        uint256 price = fund.twapOracle().getTwap(timestamp);
        require(price != 0, "Price is not available");
        return fund.extrapolateNav(timestamp, price);
    }

    /// @notice Place a bid order for makers
    /// @param tranche Tranche of the base asset
    /// @param pdLevel Premium-discount level
    /// @param quoteAmount Quote asset amount with 18 decimal places
    /// @param conversionID Current conversion ID. Revert if conversion is triggered simultaneously
    /// @param clientOrderID Optional self-assigned order ID. Index starting with 1
    function placeBid(
        uint256 tranche,
        uint256 pdLevel,
        uint256 quoteAmount,
        uint256 conversionID,
        uint256 clientOrderID
    ) external onlyMaker {
        require(quoteAmount >= minBidAmount, "Quote amount too low");
        uint256 bestAsk = bestAsks[conversionID][tranche];
        require(
            pdLevel > 0 && pdLevel < (bestAsk == 0 ? PD_LEVEL_COUNT + 1 : bestAsk),
            "Invalid premium-discount level"
        );
        require(conversionID == fund.getConversionSize(), "Invalid conversion ID");

        _transferQuoteFrom(msg.sender, quoteAmount);

        uint256 index =
            bids[conversionID][tranche][pdLevel].append(msg.sender, quoteAmount, conversionID);
        if (bestBids[conversionID][tranche] < pdLevel) {
            bestBids[conversionID][tranche] = pdLevel;
        }

        if (clientOrderID != 0) {
            require(
                identifiers[conversionID][tranche][msg.sender][clientOrderID].index == 0,
                "Client ID has already assigned an order"
            );
            identifiers[conversionID][tranche][msg.sender][clientOrderID] = OrderIdentifier({
                pdLevel: pdLevel,
                index: index
            });
        }

        emit BidOrderPlaced(
            msg.sender,
            tranche,
            pdLevel,
            quoteAmount,
            conversionID,
            clientOrderID,
            index
        );
    }

    /// @notice Place an ask order for makers
    /// @param tranche Tranche of the base asset
    /// @param pdLevel Premium-discount level
    /// @param baseAmount Base asset amount
    /// @param conversionID Current conversion ID. Revert if conversion is triggered simultaneously
    /// @param clientOrderID Optional self-assigned order ID. Index starting with 1
    function placeAsk(
        uint256 tranche,
        uint256 pdLevel,
        uint256 baseAmount,
        uint256 conversionID,
        uint256 clientOrderID
    ) external onlyMaker {
        require(baseAmount >= minAskAmount, "Base amount too low");
        require(
            pdLevel > bestBids[conversionID][tranche] && pdLevel <= PD_LEVEL_COUNT,
            "Invalid premium-discount level"
        );
        require(conversionID == fund.getConversionSize(), "Invalid conversion ID");

        _lock(tranche, msg.sender, baseAmount);
        uint256 index =
            asks[conversionID][tranche][pdLevel].append(msg.sender, baseAmount, conversionID);
        uint256 oldBestAsk = bestAsks[conversionID][tranche];
        if (oldBestAsk > pdLevel) {
            bestAsks[conversionID][tranche] = pdLevel;
        } else if (oldBestAsk == 0 && asks[conversionID][tranche][0].tail == 0) {
            // The best ask level is not initialized yet, because order queue at PD level 0 is empty
            bestAsks[conversionID][tranche] = pdLevel;
        }

        if (clientOrderID != 0) {
            require(
                identifiers[conversionID][tranche][msg.sender][clientOrderID].index == 0,
                "Client ID has already assigned an order"
            );
            identifiers[conversionID][tranche][msg.sender][clientOrderID] = OrderIdentifier({
                pdLevel: pdLevel,
                index: index
            });
        }

        emit AskOrderPlaced(
            msg.sender,
            tranche,
            pdLevel,
            baseAmount,
            conversionID,
            clientOrderID,
            index
        );
    }

    /// @notice Cancel a bid order by client order ID
    /// @param conversionID Order's conversion ID
    /// @param tranche Tranche of the order's base asset
    /// @param clientOrderID Self-assigned order ID
    function cancelBidByClientOrderID(
        uint256 conversionID,
        uint256 tranche,
        uint256 clientOrderID
    ) external {
        OrderIdentifier memory orderIdentifier =
            identifiers[conversionID][tranche][msg.sender][clientOrderID];
        _cancelBid(
            conversionID,
            tranche,
            msg.sender,
            orderIdentifier.pdLevel,
            orderIdentifier.index
        );
        delete identifiers[conversionID][tranche][msg.sender][clientOrderID];
    }

    /// @notice Cancel a bid order by order identifier
    /// @param conversionID Order's conversion ID
    /// @param tranche Tranche of the order's base asset
    /// @param pdLevel Order's premium-discount level
    /// @param index Order's index
    function cancelBid(
        uint256 conversionID,
        uint256 tranche,
        uint256 pdLevel,
        uint256 index
    ) external {
        _cancelBid(conversionID, tranche, msg.sender, pdLevel, index);
    }

    /// @notice Cancel an ask order by client order ID
    /// @param conversionID Order's conversion ID
    /// @param tranche Tranche of the order's base asset
    /// @param clientOrderID Self-assigned order ID
    function cancelAskByClientOrderID(
        uint256 conversionID,
        uint256 tranche,
        uint256 clientOrderID
    ) external {
        OrderIdentifier memory orderIdentifier =
            identifiers[conversionID][tranche][msg.sender][clientOrderID];
        _cancelAsk(
            conversionID,
            tranche,
            msg.sender,
            orderIdentifier.pdLevel,
            orderIdentifier.index
        );
        delete identifiers[conversionID][tranche][msg.sender][clientOrderID];
    }

    /// @notice Cancel an ask order by order identifier
    /// @param conversionID Order's conversion ID
    /// @param tranche Tranche of the order's base asset
    /// @param pdLevel Order's premium-discount level
    /// @param index Order's index
    function cancelAsk(
        uint256 conversionID,
        uint256 tranche,
        uint256 pdLevel,
        uint256 index
    ) external {
        _cancelAsk(conversionID, tranche, msg.sender, pdLevel, index);
    }

    /// @notice Buy share P
    /// @param conversionID Current conversion ID. Revert if conversion is triggered simultaneously
    /// @param maxPDLevel Maximal premium-discount level accepted
    /// @param quoteAmount Amount of quote assets (with 18 decimal places) willing to trade
    function buyP(
        uint256 conversionID,
        uint256 maxPDLevel,
        uint256 quoteAmount
    ) external onlyActive {
        (uint256 estimatedNav, , ) = estimateNavs(endOfEpoch(block.timestamp) - 2 * EPOCH);
        _buy(conversionID, msg.sender, TRANCHE_P, maxPDLevel, estimatedNav, quoteAmount);
    }

    /// @notice Buy share A
    /// @param conversionID Current conversion ID. Revert if conversion is triggered simultaneously
    /// @param maxPDLevel Maximal premium-discount level accepted
    /// @param quoteAmount Amount of quote assets (with 18 decimal places) willing to trade
    function buyA(
        uint256 conversionID,
        uint256 maxPDLevel,
        uint256 quoteAmount
    ) external onlyActive {
        (, uint256 estimatedNav, ) = estimateNavs(endOfEpoch(block.timestamp) - 2 * EPOCH);
        _buy(conversionID, msg.sender, TRANCHE_A, maxPDLevel, estimatedNav, quoteAmount);
    }

    /// @notice Buy share B
    /// @param conversionID Current conversion ID. Revert if conversion is triggered simultaneously
    /// @param maxPDLevel Maximal premium-discount level accepted
    /// @param quoteAmount Amount of quote assets (with 18 decimal places) willing to trade
    function buyB(
        uint256 conversionID,
        uint256 maxPDLevel,
        uint256 quoteAmount
    ) external onlyActive {
        (, , uint256 estimatedNav) = estimateNavs(endOfEpoch(block.timestamp) - 2 * EPOCH);
        _buy(conversionID, msg.sender, TRANCHE_B, maxPDLevel, estimatedNav, quoteAmount);
    }

    /// @notice Sell share P
    /// @param conversionID Current conversion ID. Revert if conversion is triggered simultaneously
    /// @param minPDLevel Minimal premium-discount level accepted
    /// @param baseAmount Amount of share P willing to trade
    function sellP(
        uint256 conversionID,
        uint256 minPDLevel,
        uint256 baseAmount
    ) external onlyActive {
        (uint256 estimatedNav, , ) = estimateNavs(endOfEpoch(block.timestamp) - 2 * EPOCH);
        _sell(conversionID, msg.sender, TRANCHE_P, minPDLevel, estimatedNav, baseAmount);
    }

    /// @notice Sell share A
    /// @param conversionID Current conversion ID. Revert if conversion is triggered simultaneously
    /// @param minPDLevel Minimal premium-discount level accepted
    /// @param baseAmount Amount of share A willing to trade
    function sellA(
        uint256 conversionID,
        uint256 minPDLevel,
        uint256 baseAmount
    ) external onlyActive {
        (, uint256 estimatedNav, ) = estimateNavs(endOfEpoch(block.timestamp) - 2 * EPOCH);
        _sell(conversionID, msg.sender, TRANCHE_A, minPDLevel, estimatedNav, baseAmount);
    }

    /// @notice Sell share B
    /// @param conversionID Current conversion ID. Revert if conversion is triggered simultaneously
    /// @param minPDLevel Minimal premium-discount level accepted
    /// @param baseAmount Amount of share B willing to trade
    function sellB(
        uint256 conversionID,
        uint256 minPDLevel,
        uint256 baseAmount
    ) external onlyActive {
        (, , uint256 estimatedNav) = estimateNavs(endOfEpoch(block.timestamp) - 2 * EPOCH);
        _sell(conversionID, msg.sender, TRANCHE_B, minPDLevel, estimatedNav, baseAmount);
    }

    /// @notice Settle trades of a specified epoch for makers
    /// @param epoch A specified epoch's end timestamp
    /// @return sharesP Share P amount added to msg.sender's available balance
    /// @return sharesA Share A amount added to msg.sender's available balance
    /// @return sharesB Share B amount added to msg.sender's available balance
    /// @return quoteAmount Quote asset amount transfered to msg.sender, rounding precison to 18
    ///                     for quote assets with precision other than 18 decimal places
    function settleMaker(uint256 epoch)
        external
        returns (
            uint256 sharesP,
            uint256 sharesA,
            uint256 sharesB,
            uint256 quoteAmount
        )
    {
        (uint256 estimatedNavP, uint256 estimatedNavA, uint256 estimatedNavB) =
            estimateNavs(epoch.add(EPOCH));

        uint256 quoteAmountP;
        uint256 quoteAmountA;
        uint256 quoteAmountB;
        (sharesP, quoteAmountP) = _settleMaker(msg.sender, TRANCHE_P, estimatedNavP, epoch);
        (sharesA, quoteAmountA) = _settleMaker(msg.sender, TRANCHE_A, estimatedNavA, epoch);
        (sharesB, quoteAmountB) = _settleMaker(msg.sender, TRANCHE_B, estimatedNavB, epoch);

        uint256 conversionID = mostRecentConversionPendingTrades[epoch];
        (sharesP, sharesA, sharesB) = _convertAndClearTrade(
            msg.sender,
            sharesP,
            sharesA,
            sharesB,
            conversionID
        );
        quoteAmount = quoteAmountP.add(quoteAmountA).add(quoteAmountB);
        _transferQuote(msg.sender, quoteAmount);

        emit MakerSettled(msg.sender, epoch, sharesP, sharesA, sharesB, quoteAmount);
    }

    /// @notice Settle trades of a specified epoch for takers
    /// @param epoch A specified epoch's end timestamp
    /// @return sharesP Share P amount added to msg.sender's available balance
    /// @return sharesA Share A amount added to msg.sender's available balance
    /// @return sharesB Share B amount added to msg.sender's available balance
    /// @return quoteAmount Quote asset amount transfered to msg.sender, rounding precison to 18
    ///                     for quote assets with precision other than 18 decimal places
    function settleTaker(uint256 epoch)
        external
        returns (
            uint256 sharesP,
            uint256 sharesA,
            uint256 sharesB,
            uint256 quoteAmount
        )
    {
        (uint256 estimatedNavP, uint256 estimatedNavA, uint256 estimatedNavB) =
            estimateNavs(epoch.add(EPOCH));

        uint256 quoteAmountP;
        uint256 quoteAmountA;
        uint256 quoteAmountB;
        (sharesP, quoteAmountP) = _settleTaker(msg.sender, TRANCHE_P, estimatedNavP, epoch);
        (sharesA, quoteAmountA) = _settleTaker(msg.sender, TRANCHE_A, estimatedNavA, epoch);
        (sharesB, quoteAmountB) = _settleTaker(msg.sender, TRANCHE_B, estimatedNavB, epoch);

        uint256 conversionID = mostRecentConversionPendingTrades[epoch];
        (sharesP, sharesA, sharesB) = _convertAndClearTrade(
            msg.sender,
            sharesP,
            sharesA,
            sharesB,
            conversionID
        );
        quoteAmount = quoteAmountP.add(quoteAmountA).add(quoteAmountB);
        _transferQuote(msg.sender, quoteAmount);

        emit TakerSettled(msg.sender, epoch, sharesP, sharesA, sharesB, quoteAmount);
    }

    /// @dev Cancel a bid order
    /// @param conversionID Order's conversion ID
    /// @param tranche Tranche of the order's base asset
    /// @param maker Order's maker address
    /// @param pdLevel Order's premium-discount level
    /// @param index Order's index
    function _cancelBid(
        uint256 conversionID,
        uint256 tranche,
        address maker,
        uint256 pdLevel,
        uint256 index
    ) internal {
        OrderQueue storage orderQueue = bids[conversionID][tranche][pdLevel];
        Order storage order = orderQueue.list[index];
        require(order.maker == maker, "Maker address mismatched");

        uint256 fillable = order.fillable;
        emit BidOrderCanceled(maker, tranche, pdLevel, order.amount, conversionID, index, fillable);
        orderQueue.cancel(index);

        // Update bestBid
        if (bestBids[conversionID][tranche] == pdLevel) {
            uint256 newBestBid = pdLevel;
            while (newBestBid > 0 && bids[conversionID][tranche][newBestBid].isEmpty()) {
                newBestBid--;
            }
            bestBids[conversionID][tranche] = newBestBid;
        }

        _transferQuote(maker, fillable);
    }

    /// @dev Cancel an ask order
    /// @param conversionID Order's conversion ID
    /// @param tranche Tranche of the order's base asset address
    /// @param maker Order's maker address
    /// @param pdLevel Order's premium-discount level
    /// @param index Order's index
    function _cancelAsk(
        uint256 conversionID,
        uint256 tranche,
        address maker,
        uint256 pdLevel,
        uint256 index
    ) internal {
        OrderQueue storage orderQueue = asks[conversionID][tranche][pdLevel];
        Order storage order = orderQueue.list[index];
        require(order.maker == maker, "Maker address mismatched");

        uint256 fillable = order.fillable;
        emit AskOrderCanceled(maker, tranche, pdLevel, order.amount, conversionID, index, fillable);
        orderQueue.cancel(index);

        // Update bestAsk
        if (bestAsks[conversionID][tranche] == pdLevel) {
            uint256 newBestAsk = pdLevel;
            while (
                newBestAsk <= PD_LEVEL_COUNT && asks[conversionID][tranche][newBestAsk].isEmpty()
            ) {
                newBestAsk++;
            }
            bestAsks[conversionID][tranche] = newBestAsk;
        }

        if (tranche == TRANCHE_P) {
            _convertAndUnlock(maker, fillable, 0, 0, conversionID);
        } else if (tranche == TRANCHE_A) {
            _convertAndUnlock(maker, 0, fillable, 0, conversionID);
        } else {
            _convertAndUnlock(maker, 0, 0, fillable, conversionID);
        }
    }

    /// @dev Buy share
    /// @param conversionID Current conversion ID. Revert if conversion is triggered simultaneously
    /// @param taker Taker address
    /// @param tranche Tranche of the base asset
    /// @param maxPDLevel Maximal premium-discount level accepted
    /// @param estimatedNav Estimated net asset value of the base asset
    /// @param quoteAmount Amount of quote assets willing to trade with 18 decimal places
    function _buy(
        uint256 conversionID,
        address taker,
        uint256 tranche,
        uint256 maxPDLevel,
        uint256 estimatedNav,
        uint256 quoteAmount
    ) internal {
        require(maxPDLevel > 0 && maxPDLevel <= PD_LEVEL_COUNT, "Invalid premium-discount level");
        require(conversionID == fund.getConversionSize(), "Invalid conversion ID");

        PendingBuyTrade memory totalTrade;
        uint256 epoch = endOfEpoch(block.timestamp);

        // Record epoch ID => conversion ID in the first trasaction in the epoch
        if (mostRecentConversionPendingTrades[epoch] != conversionID) {
            mostRecentConversionPendingTrades[epoch] = conversionID;
        }

        PendingBuyTrade memory currentTrade;
        uint256 orderIndex = 0;
        uint256 pdLevel = bestAsks[conversionID][tranche];
        if (pdLevel == 0) {
            // Zero best ask indicates that no ask order is ever placed.
            // We set pdLevel beyond the largest valid level, forcing the following loop
            // to exit immediately.
            pdLevel = PD_LEVEL_COUNT + 1;
        }
        for (; pdLevel <= maxPDLevel; pdLevel++) {
            uint256 price = pdLevel.mul(PD_TICK).add(PD_START).multiplyDecimal(estimatedNav);
            OrderQueue storage orderQueue = asks[conversionID][tranche][pdLevel];
            orderIndex = orderQueue.head;
            while (orderIndex != 0) {
                Order storage order = orderQueue.list[orderIndex];

                // If the order initiator is no longer qualified for maker,
                // we would only skip the order since the linked-list-based order queue
                // would never traverse the order again
                if (!isMaker(order.maker)) {
                    orderIndex = order.next;
                    continue;
                }

                // Calculate the current trade assuming that the taker would be completely filled.
                currentTrade.frozenQuote = quoteAmount.sub(totalTrade.frozenQuote);
                currentTrade.reservedBase = currentTrade.frozenQuote.mul(MAKER_RESERVE_RATIO).div(
                    price
                );

                if (currentTrade.reservedBase < order.fillable) {
                    // Taker is completely filled.
                    currentTrade.effectiveQuote = currentTrade.frozenQuote.divideDecimal(
                        pdLevel.mul(PD_TICK).add(PD_START)
                    );
                } else {
                    // Maker is completely filled. Recalculate the current trade.
                    currentTrade.frozenQuote = order.fillable.mul(price).div(MAKER_RESERVE_RATIO);
                    currentTrade.effectiveQuote = order.fillable.mul(estimatedNav).div(
                        MAKER_RESERVE_RATIO
                    );
                    currentTrade.reservedBase = order.fillable;
                }
                totalTrade.frozenQuote = totalTrade.frozenQuote.add(currentTrade.frozenQuote);
                totalTrade.effectiveQuote = totalTrade.effectiveQuote.add(
                    currentTrade.effectiveQuote
                );
                totalTrade.reservedBase = totalTrade.reservedBase.add(currentTrade.reservedBase);
                pendingTrades[order.maker][tranche][epoch].makerSell.add(currentTrade);

                // There is no need to convert for maker; the fact that the order could
                // be filled here indicates that the maker is in the latest version
                _tradeLocked(tranche, order.maker, currentTrade.reservedBase);

                uint256 orderNewFillable = order.fillable.sub(currentTrade.reservedBase);
                if (orderNewFillable > 0) {
                    // Maker is not completely filled. Matching ends here.
                    order.fillable = orderNewFillable;
                    break;
                } else {
                    // Delete the completely filled maker order.
                    orderIndex = orderQueue.fill(orderIndex);
                }
            }

            orderQueue.updateHead(orderIndex);
            if (orderIndex != 0) {
                // This premium-discount level is not completely filled. Matching ends here.
                if (bestAsks[conversionID][tranche] != pdLevel) {
                    bestAsks[conversionID][tranche] = pdLevel;
                }
                break;
            }
        }
        emit BuyTrade(
            taker,
            tranche,
            totalTrade.frozenQuote,
            conversionID,
            pdLevel,
            orderIndex,
            orderIndex == 0 ? 0 : currentTrade.reservedBase
        );
        if (orderIndex == 0) {
            // Matching ends by completely filling all orders at and below the specified
            // premium-discount level `maxPDLevel`.
            // Find the new best ask beyond that level.
            for (; pdLevel <= PD_LEVEL_COUNT; pdLevel++) {
                if (!asks[conversionID][tranche][pdLevel].isEmpty()) {
                    break;
                }
            }
            bestAsks[conversionID][tranche] = pdLevel;
        }

        require(
            totalTrade.frozenQuote > 0,
            "Nothing can be bought at the given premium-discount level"
        );
        _transferQuoteFrom(taker, totalTrade.frozenQuote);
        pendingTrades[taker][tranche][epoch].takerBuy.add(totalTrade);
    }

    /// @dev Sell share
    /// @param conversionID Current conversion ID. Revert if conversion is triggered simultaneously
    /// @param taker Taker address
    /// @param tranche Tranche of the base asset
    /// @param minPDLevel Minimal premium-discount level accepted
    /// @param estimatedNav Estimated net asset value of the base asset
    /// @param baseAmount Amount of base assets willing to trade
    function _sell(
        uint256 conversionID,
        address taker,
        uint256 tranche,
        uint256 minPDLevel,
        uint256 estimatedNav,
        uint256 baseAmount
    ) internal {
        require(minPDLevel > 0 && minPDLevel <= PD_LEVEL_COUNT, "Invalid premium-discount level");
        require(conversionID == fund.getConversionSize(), "Invalid conversion ID");

        PendingSellTrade memory totalTrade;
        uint256 epoch = endOfEpoch(block.timestamp);

        // Record epoch ID => conversion ID in the first trasaction in the epoch
        if (mostRecentConversionPendingTrades[epoch] != conversionID) {
            mostRecentConversionPendingTrades[epoch] = conversionID;
        }

        PendingSellTrade memory currentTrade;
        uint256 orderIndex;
        uint256 pdLevel = bestBids[conversionID][tranche];
        for (; pdLevel >= minPDLevel; pdLevel--) {
            uint256 price = pdLevel.mul(PD_TICK).add(PD_START).multiplyDecimal(estimatedNav);
            OrderQueue storage orderQueue = bids[conversionID][tranche][pdLevel];
            orderIndex = orderQueue.head;
            while (orderIndex != 0) {
                Order storage order = orderQueue.list[orderIndex];

                // If the order initiator is no longer qualified for maker,
                // we would only skip the order since the linked-list-based order queue
                // would never traverse the order again
                if (!isMaker(order.maker)) {
                    orderIndex = order.next;
                    continue;
                }

                currentTrade.frozenBase = baseAmount.sub(totalTrade.frozenBase);
                currentTrade.reservedQuote = currentTrade
                    .frozenBase
                    .multiplyDecimal(MAKER_RESERVE_RATIO)
                    .multiplyDecimal(price);

                if (currentTrade.reservedQuote < order.fillable) {
                    // Taker is completely filled
                    currentTrade.effectiveBase = currentTrade.frozenBase.multiplyDecimal(
                        pdLevel.mul(PD_TICK).add(PD_START)
                    );
                } else {
                    // Maker is completely filled. Recalculate the current trade.
                    currentTrade.frozenBase = order.fillable.divideDecimal(price).divideDecimal(
                        MAKER_RESERVE_RATIO
                    );
                    currentTrade.effectiveBase = order
                        .fillable
                        .divideDecimal(estimatedNav)
                        .divideDecimal(MAKER_RESERVE_RATIO);
                    currentTrade.reservedQuote = order.fillable;
                }
                totalTrade.frozenBase = totalTrade.frozenBase.add(currentTrade.frozenBase);
                totalTrade.effectiveBase = totalTrade.effectiveBase.add(currentTrade.effectiveBase);
                totalTrade.reservedQuote = totalTrade.reservedQuote.add(currentTrade.reservedQuote);
                pendingTrades[order.maker][tranche][epoch].makerBuy.add(currentTrade);

                uint256 orderNewFillable = order.fillable.sub(currentTrade.reservedQuote);
                if (orderNewFillable > 0) {
                    // Maker is not completely filled. Matching ends here.
                    order.fillable = orderNewFillable;
                    break;
                } else {
                    // Delete the completely filled maker order.
                    orderIndex = orderQueue.fill(orderIndex);
                }
            }

            orderQueue.updateHead(orderIndex);
            if (orderIndex != 0) {
                // This premium-discount level is not completely filled. Matching ends here.
                if (bestBids[conversionID][tranche] != pdLevel) {
                    bestBids[conversionID][tranche] = pdLevel;
                }
                break;
            }
        }
        emit SellTrade(
            taker,
            tranche,
            totalTrade.frozenBase,
            conversionID,
            pdLevel,
            orderIndex,
            orderIndex == 0 ? 0 : currentTrade.reservedQuote
        );
        if (orderIndex == 0) {
            // Matching ends by completely filling all orders at and above the specified
            // premium-discount level `minPDLevel`.
            // Find the new best ask beyond that level.
            for (; pdLevel > 0; pdLevel--) {
                if (!bids[conversionID][tranche][pdLevel].isEmpty()) {
                    break;
                }
            }
            bestBids[conversionID][tranche] = pdLevel;
        }

        require(
            totalTrade.frozenBase > 0,
            "Nothing can be sold at the given premium-discount level"
        );
        _tradeAvailable(tranche, taker, totalTrade.frozenBase);
        pendingTrades[taker][tranche][epoch].takerSell.add(totalTrade);
    }

    /// @dev Settle both buy and sell trades of a specified epoch for takers
    /// @param account Taker address
    /// @param tranche Tranche of the base asset
    /// @param estimatedNav Estimated net asset value for the base asset
    /// @param epoch The epoch's end timestamp
    function _settleTaker(
        address account,
        uint256 tranche,
        uint256 estimatedNav,
        uint256 epoch
    ) internal returns (uint256 baseAmount, uint256 quoteAmount) {
        PendingTrade storage pendingTrade = pendingTrades[account][tranche][epoch];

        // Settle buy trade
        PendingBuyTrade memory takerBuy = pendingTrade.takerBuy;
        if (takerBuy.frozenQuote > 0) {
            (uint256 executionQuote, uint256 executionBase) =
                _buyTradeResult(takerBuy, estimatedNav);
            baseAmount = baseAmount.add(executionBase);

            uint256 refundQuote = takerBuy.frozenQuote.sub(executionQuote);
            quoteAmount = quoteAmount.add(refundQuote);

            // Delete by zeroing it out
            delete pendingTrade.takerBuy;
        }

        // Settle sell trade
        PendingSellTrade memory takerSell = pendingTrade.takerSell;
        if (takerSell.frozenBase > 0) {
            (uint256 executionQuote, uint256 executionBase) =
                _sellTradeResult(takerSell, estimatedNav);
            quoteAmount = quoteAmount.add(executionQuote);

            uint256 refundBase = takerSell.frozenBase.sub(executionBase);
            baseAmount = baseAmount.add(refundBase);

            // Delete by zeroing it out
            delete pendingTrade.takerSell;
        }
    }

    /// @dev Settle both buy and sell trades of a specified epoch for makers
    /// @param account Maker address
    /// @param tranche Tranche of the base asset
    /// @param estimatedNav Estimated net asset value for the base asset
    /// @param epoch The epoch's end timestamp
    function _settleMaker(
        address account,
        uint256 tranche,
        uint256 estimatedNav,
        uint256 epoch
    ) internal returns (uint256 baseAmount, uint256 quoteAmount) {
        PendingTrade storage pendingTrade = pendingTrades[account][tranche][epoch];

        // Settle buy trade
        PendingSellTrade memory makerBuy = pendingTrade.makerBuy;
        if (makerBuy.frozenBase > 0) {
            (uint256 executionQuote, uint256 executionBase) =
                _sellTradeResult(makerBuy, estimatedNav);
            baseAmount = baseAmount.add(executionBase);

            uint256 refundQuote = makerBuy.reservedQuote.sub(executionQuote);
            quoteAmount = quoteAmount.add(refundQuote);

            // Delete by zeroing it out
            delete pendingTrade.makerBuy;
        }

        // Settle sell trade
        PendingBuyTrade memory makerSell = pendingTrade.makerSell;
        if (makerSell.frozenQuote > 0) {
            (uint256 executionQuote, uint256 executionBase) =
                _buyTradeResult(makerSell, estimatedNav);
            quoteAmount = quoteAmount.add(executionQuote);

            uint256 refundBase = makerSell.reservedBase.sub(executionBase);
            baseAmount = baseAmount.add(refundBase);

            // Delete by zeroing it out
            delete pendingTrade.makerSell;
        }
    }

    /// @dev Calculate the result of a pending buy trade with a given NAV
    /// @param buyTrade Buy trade result of this particular epoch
    /// @param nav Net asset value for the base asset
    /// @return executionQuote Real amount of quote asset waiting for settlment
    /// @return executionBase Real amount of base asset waiting for settlment
    function _buyTradeResult(PendingBuyTrade memory buyTrade, uint256 nav)
        internal
        pure
        returns (uint256 executionQuote, uint256 executionBase)
    {
        uint256 reservedBase = buyTrade.reservedBase;
        uint256 reservedQuote = reservedBase.multiplyDecimal(nav);
        uint256 effectiveQuote = buyTrade.effectiveQuote;
        if (effectiveQuote < reservedQuote) {
            // Reserved base is enough to execute the trade.
            // nav is always positive here
            return (buyTrade.frozenQuote, effectiveQuote.divideDecimal(nav));
        } else {
            // Reserved base is not enough. The trade is partially executed
            // and a fraction of frozenQuote is returned to the taker.
            return (buyTrade.frozenQuote.mul(reservedQuote).div(effectiveQuote), reservedBase);
        }
    }

    /// @dev Calculate the result of a pending sell trade with a given NAV
    /// @param sellTrade Sell trade result of this particular epoch
    /// @param nav Net asset value for the base asset
    /// @return executionQuote Real amount of quote asset waiting for settlment
    /// @return executionBase Real amount of base asset waiting for settlment
    function _sellTradeResult(PendingSellTrade memory sellTrade, uint256 nav)
        internal
        pure
        returns (uint256 executionQuote, uint256 executionBase)
    {
        uint256 reservedQuote = sellTrade.reservedQuote;
        uint256 effectiveQuote = sellTrade.effectiveBase.multiplyDecimal(nav);
        if (effectiveQuote < reservedQuote) {
            // Reserved quote is enough to execute the trade.
            return (effectiveQuote, sellTrade.frozenBase);
        } else {
            // Reserved quote is not enough. The trade is partially executed
            // and a fraction of frozenBase is returned to the taker.
            return (reservedQuote, sellTrade.frozenBase.mul(reservedQuote).div(effectiveQuote));
        }
    }

    /// @dev Transfer quote asset to an account. Transfered amount is rounded down.
    /// @param account Recipient address
    /// @param amount Amount to transfer with 18 decimal places
    function _transferQuote(address account, uint256 amount) private {
        uint256 amountToTransfer = amount / _quoteDecimalMultiplier;
        if (amountToTransfer == 0) {
            return;
        }
        require(
            IERC20(quoteAssetAddress).transfer(account, amountToTransfer),
            "Failed to transfer quote asset"
        );
    }

    /// @dev Transfer quote asset from an account. Transfered amount is rounded up.
    /// @param account Sender address
    /// @param amount Amount to transfer with 18 decimal places
    function _transferQuoteFrom(address account, uint256 amount) private {
        uint256 amountToTransfer =
            amount.add(_quoteDecimalMultiplier - 1) / _quoteDecimalMultiplier;
        require(
            IERC20(quoteAssetAddress).transferFrom(account, address(this), amountToTransfer),
            "Failed to transfer quote asset from account"
        );
    }

    modifier onlyActive() {
        require(fund.isExchangeActive(block.timestamp), "Exchange is inactive");
        _;
    }
}
