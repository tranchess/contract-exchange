// SPDX-License-Identifier: MIT
pragma solidity ^0.6.9;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";

/// @title Tranchess's Exchange Order Queue Contract
/// @notice Order queue struct and implementation using doubly linked list
/// @author Tranchess
contract ExchangeOrderBook {
    using SafeMath for uint256;

    struct Order {
        uint256 prev; // Previous order in the list
        uint256 next; // Next order in the list
        address makerAddress; // Maker address of the order
        uint256 amount; // Total amount of assets
        uint256 conversionID; // Conversion ID when the order was placed
        uint256 fillable; // Currently fillable amount of assets
    }

    struct OrderQueue {
        mapping(uint256 => Order) list; // Mapping of order index => order struct
        uint256 totalAmount; // Total order depth of the order queue
        uint256 head; // Head of the linked list
        uint256 tail; // Tail of the linekd list
    }

    /// @notice Append a new order to the queue
    /// @param queue Order queue
    /// @param makerAddress Maker address
    /// @param amount Amount to place in the order
    /// @param conversionID Current conversion ID
    /// @return index Index of the order in order queue
    function _appendOrder(
        OrderQueue storage queue,
        address makerAddress,
        uint256 amount,
        uint256 conversionID
    ) internal returns (uint256 index) {
        queue.totalAmount += amount;

        index = queue.tail + 1;
        queue.list[index] = Order({
            prev: queue.tail,
            next: 0,
            makerAddress: makerAddress,
            amount: amount,
            conversionID: conversionID,
            fillable: amount
        });

        if (queue.tail != 0) {
            queue.list[queue.tail].next = index;
        }

        if (queue.head == 0) {
            queue.head = index;
        }
        queue.tail = index;
    }

    /// @notice Remove a order from the queue
    /// @param queue Order queue
    /// @param index Index of the order in order queue
    function _removeOrder(OrderQueue storage queue, uint256 index) internal {
        Order memory order = queue.list[index];
        queue.totalAmount -= order.fillable;

        if (order.prev == 0) {
            queue.head = order.next;
        } else {
            queue.list[order.prev].next = order.next;
        }

        if (order.next == 0) {
            queue.tail = order.prev;
        } else {
            queue.list[order.next].prev = order.prev;
        }

        delete queue.list[index];
    }
}
