// SPDX-License-Identifier: MIT
pragma solidity >=0.6.10 <0.8.0;

import "@openzeppelin/contracts/math/SafeMath.sol";

struct Order {
    uint256 prev; // Previous order in the list
    uint256 next; // Next order in the list
    address makerAddress; // Maker address of the order
    uint256 amount; // Total amount of assets
    uint256 conversionID; // Conversion ID when the order was placed
    uint256 fillable; // Currently fillable amount of assets
}

/// @notice A queue of orders with the same premium-discount level.
///
///         An order queue assigns a unique index to each order and stores the orders in a doubly
///         linked list. Orders can be removed from the queue by cancellation, expiration or trade.
/// @param list Mapping of order index => order
/// @param head Index of the first order in the queue, or zero if the queue is empty
/// @param tail Index of the last order in the queue, or zero if the queue is empty
/// @param counter The total number of orders that have been added to the queue, no matter whether
///                they are still active or not
struct OrderQueue {
    mapping(uint256 => Order) list;
    uint256 head;
    uint256 tail;
    uint256 counter;
}

/// @title Tranchess's Exchange Order Queue Contract
/// @notice Order queue struct and implementation using doubly linked list
/// @author Tranchess
library LibOrderBook {
    using SafeMath for uint256;

    function isEmpty(OrderQueue storage queue) internal view returns (bool) {
        return queue.head == 0;
    }

    /// @notice Append a new order to the queue
    /// @param queue Order queue
    /// @param makerAddress Maker address
    /// @param amount Amount to place in the order
    /// @param conversionID Current conversion ID
    /// @return Index of the order in the order queue
    function append(
        OrderQueue storage queue,
        address makerAddress,
        uint256 amount,
        uint256 conversionID
    ) internal returns (uint256) {
        uint256 index = queue.counter + 1;
        queue.counter = index;
        uint256 tail = queue.tail;
        queue.list[index] = Order({
            prev: tail,
            next: 0,
            makerAddress: makerAddress,
            amount: amount,
            conversionID: conversionID,
            fillable: amount
        });
        if (tail == 0) {
            // The queue was empty.
            queue.head = index;
        } else {
            // The queue was not empty.
            queue.list[tail].next = index;
        }
        queue.tail = index;
        return index;
    }

    /// @dev Cancel an order from the queue.
    /// @param queue Order queue
    /// @param index Index of the order to be canceled
    function cancel(OrderQueue storage queue, uint256 index) internal {
        uint256 oldHead = queue.head;
        if (index >= oldHead && oldHead > 0) {
            // The order is still active.
            Order storage order = queue.list[index];
            uint256 prev = order.prev;
            uint256 next = order.next;
            if (prev == 0 && next == 0) {
                // This is the only order in the queue.
                queue.head = 0;
                queue.tail = 0;
            } else if (prev == 0) {
                // This is the first but not the only order.
                queue.head = next;
                queue.list[next].prev = 0;
            } else if (next == 0) {
                // This is the last but not the only order.
                queue.list[prev].next = 0;
                queue.tail = prev;
            }
        }
        delete queue.list[index];
    }

    /// @dev Remove an order that is completely filled in matching. Links of the previous
    ///      and next order are not updated here. Caller must call `updateHead` after finishing
    ///      the matching on this queue.
    /// @param queue Order queue
    /// @param index Index of the order to be removed
    /// @return nextIndex Index of the next order, or zero if the removed order is the last one
    function fill(OrderQueue storage queue, uint256 index) internal returns (uint256 nextIndex) {
        nextIndex = queue.list[index].next;
        delete queue.list[index];
    }

    /// @dev Update head and tail of the queue. This function should be called after matching
    ///      a taker order with this order queue and all orders before the new head are either
    ///      completely filled or expired.
    /// @param queue Order queue
    /// @param newHead Index of the first order that is still active now,
    ///                or zero if the queue is empty
    function updateHead(OrderQueue storage queue, uint256 newHead) internal {
        queue.head = newHead;
        if (newHead == 0) {
            queue.tail = 0;
        } else {
            queue.list[newHead].prev = 0;
        }
    }
}
