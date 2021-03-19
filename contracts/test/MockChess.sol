// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;

import "./MockToken.sol";

contract MockChess is MockToken {
    uint256 public rate;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals
    ) public MockToken(name, symbol, decimals) {}

    function setRate(uint256 value) external {
        rate = value;
    }
}
