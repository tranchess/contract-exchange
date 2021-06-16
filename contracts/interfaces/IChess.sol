// SPDX-License-Identifier: MIT
pragma solidity >=0.6.10 <0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IChess is IERC20 {
    function rate() external view returns (uint256);

    function mint(address account, uint256 amount) external;

    function futureDayTimeWrite() external returns (uint256, uint256);

    function addMinter(address account) external;
}
