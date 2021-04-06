// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;

import "./MockToken.sol";

contract MockChess is MockToken {
    uint256 public _nextEpoch;
    uint256 public _rate;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals
    ) public MockToken(name, symbol, decimals) {}

    function set(uint256 nextEpoch, uint256 rate) external {
        _nextEpoch = nextEpoch;
        _rate = rate;
    }

    function futureDayTimeWrite() external view returns (uint256 nextEpoch, uint256 rate) {
        nextEpoch = _nextEpoch;
        rate = _rate;
    }
}
