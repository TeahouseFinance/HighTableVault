// contracts/MockWETH9.sol
// SPDX-License-Identifier: GPLv3
// Teahouse Finance, with codes from Dapphub

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockWETH9 is ERC20 {

    event Deposit(address indexed dst, uint wad);
    event Withdrawal(address indexed src, uint wad);

    constructor() ERC20("Mock Wrapped ETH", "WETH") {
        // do nothing
    }

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        // NOTE: different behavior with actual WETH9 contract
        // actual WETH9 contract does not emit "Transfer" event when depositing
        _mint(msg.sender, msg.value);
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 wad) public {
        // NOTE: different behavior with actual WETH9 contract
        // actual WETH9 contract does not emit "Transfer" event when withdrawing
        _burn(msg.sender, wad);
        payable(msg.sender).transfer(wad);
        emit Withdrawal(msg.sender, wad);
    }

}
