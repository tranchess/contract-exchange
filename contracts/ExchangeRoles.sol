// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./interfaces/IVotingEscrow.sol";

/// @title Tranchess's Exchange Role Contract
/// @notice Exchange role management
/// @author Tranchess
abstract contract ExchangeRoles {
    /// @notice Voting Escrow.
    IVotingEscrow public immutable votingEscrow;

    /// @notice Minimum vote-locked governance token balance required to place maker orders.
    uint256 public makerRequirement;

    /// @notice Mapping of account => maker expiration timestamp
    mapping(address => uint256) public makerExpiration;

    constructor(address votingEscrow_) public {
        votingEscrow = IVotingEscrow(votingEscrow_);
    }

    function _initExchangeRoles(uint256 makerRequirement_) internal {
        makerRequirement = makerRequirement_;
    }

    // ------------------------------ MAKER ------------------------------------
    /// @notice Functions with this modifer can only be invoked by makers
    modifier onlyMaker() {
        require(isMaker(msg.sender), "Only maker");
        _;
    }

    /// @notice Verify if the account is an active maker or not
    /// @param account Account address to verify
    /// @return True if the account is an active maker; else returns false
    function isMaker(address account) public view returns (bool) {
        return makerExpiration[account] > block.timestamp;
    }

    /// @notice Apply for maker membership
    function applyForMaker() external {
        // The membership will be valid until the current vote-locked governance
        // token balance drop below the requirement.
        makerExpiration[msg.sender] = votingEscrow.getTimestampDropBelow(
            msg.sender,
            makerRequirement
        );
    }
}
