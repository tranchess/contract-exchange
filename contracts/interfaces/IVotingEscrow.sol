// SPDX-License-Identifier: MIT
pragma solidity >=0.6.10 <0.8.0;
pragma experimental ABIEncoderV2;

interface IVotingEscrow {
    struct LockedBalance {
        uint256 amount;
        uint256 unlockTime;
    }

    enum LockType {
        DEPOSIT_FOR_TYPE,
        CREATE_LOCK_TYPE,
        INCREASE_LOCK_AMOUNT,
        INCREASE_UNLOCK_TIME,
        INVALID_TYPE
    }

    event Locked(
        address indexed account,
        uint256 amount,
        uint256 indexed unlockTime,
        LockType lockType,
        uint256 blockTimestamp
    );
    event Withdrawn(address indexed account, uint256 amount, uint256 blockTimestamp);

    function token() external view returns (address);

    function balanceOf(address account) external view returns (uint256);

    function totalSupply() external view returns (uint256);

    function balanceOfAtTimestamp(address account, uint256 timestamp)
        external
        view
        returns (uint256);

    function getTimestampDropBelow(address account, uint256 threshold)
        external
        view
        returns (uint256);
    //function burn(uint256 amount) external;
}
