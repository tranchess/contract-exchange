// SPDX-License-Identifier: MIT
pragma solidity >=0.6.10 <0.8.0;

import "../utils/SafeDecimalMath.sol";

contract ChessController {
    /// @notice Get Fund relative weight (not more than 1.0) normalized to 1e18
    ///         (e.g. 1.0 == 1e18). Inflation which will be received by it is
    ///         inflation_rate * relative_weight / 1e18
    /// @return relativeWeight Value of relative weight normalized to 1e18
    function getFundRelativeWeight(
        address, /*account*/
        uint256 /*timestamp*/
    ) external view returns (uint256 relativeWeight) {
        relativeWeight = 1e18;
    }
}
