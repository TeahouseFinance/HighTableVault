// contracts/MockERC20.sol
// SPDX-License-Identifier: MIT
// Teahouse Finance

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(uint256 initialSupply) ERC20("Mock ERC20", "MOCK") {
        _mint(msg.sender, initialSupply);
    }
}
