// contracts/MockTeaVaultV2.sol
// SPDX-License-Identifier: MIT
// Teahouse Finance

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "../ITeaVaultV2.sol";

error CallerIsNotInvestor();
error IncorrectValue();
error InvalidRecipientAddress();

contract MockTeaVaultV2 is ITeaVaultV2, ReentrancyGuard, Ownable {

    address public investor;

    event InvestorChanged(address indexed sender, address newInvestor);
    event TokenDeposited(address indexed sender, address indexed token, uint256 amount);
    event TokenWithdrawed(address indexed sender, address indexed recipient, address indexed token, uint256 amount);
    event Token721Deposited(address indexed sender, address indexed token, uint256 tokenId);
    event Token721Withdrawed(address indexed sender, address indexed recipient, address indexed token, uint256 tokenId);
    event Token1155Deposited(address indexed sender, address indexed token, uint256 tokenId, uint256 amount);
    event Token1155Withdrawed(address indexed sender, address indexed recipient, address indexed token, uint256 tokenId, uint256 amount);
    event ETHDeposited(address indexed sender, uint256 amount);
    event ETHWithdrawed(address indexed sender, address indexed recipient, uint256 amount);

    constructor(address _investor) {
        investor = _investor;
    }

    function assignInvestor(address _investor) external onlyOwner {
        investor = _investor;
        emit InvestorChanged(msg.sender, _investor);
    }

    function deposit(address _token, uint256 _amount) external nonReentrant onlyInvestor {
        SafeERC20.safeTransferFrom(IERC20(_token), msg.sender, address(this), _amount);
        emit TokenDeposited(msg.sender, _token, _amount);
    }

    function withdraw(address _recipient, address _token, uint256 _amount) external nonReentrant onlyInvestor {
        if (_recipient == address(0)) revert InvalidRecipientAddress();

        SafeERC20.safeTransfer(IERC20(_token), _recipient, _amount);
        emit TokenWithdrawed(msg.sender, _recipient, _token, _amount);
    }

    function deposit721(address _token, uint256 _tokenId) external nonReentrant onlyInvestor {
        IERC721(_token).safeTransferFrom(msg.sender, address(this), _tokenId);
        emit Token721Deposited(msg.sender, _token, _tokenId);
    }

    function withdraw721(address _recipient, address _token, uint256 _tokenId) external nonReentrant onlyInvestor {
        if (_recipient == address(0)) revert InvalidRecipientAddress();

        IERC721(_token).safeTransferFrom(address(this), _recipient, _tokenId);
        emit Token721Withdrawed(msg.sender, _recipient, _token, _tokenId);
    }

    function deposit1155(address _token, uint256 _tokenId, uint256 _amount) external nonReentrant onlyInvestor {
        IERC1155(_token).safeTransferFrom(msg.sender, address(this), _tokenId, _amount, "");
        emit Token1155Deposited(msg.sender, _token, _tokenId, _amount);
    }

    function withdraw1155(address _recipient, address _token, uint256 _tokenId, uint256 _amount) external nonReentrant onlyInvestor {
        if (_recipient == address(0)) revert InvalidRecipientAddress();

        IERC1155(_token).safeTransferFrom(address(this), _recipient, _tokenId, _amount, "");
        emit Token1155Withdrawed(msg.sender, _recipient, _token, _tokenId, _amount);
    }

    function depositETH(uint256 _amount) external payable nonReentrant onlyInvestor {
        if (msg.value != _amount) revert IncorrectValue();
        emit ETHDeposited(msg.sender, _amount);
    }

    function withdrawETH(address payable _recipient, uint256 _amount) external nonReentrant onlyInvestor {
        if (_recipient == address(0)) revert InvalidRecipientAddress();

        Address.sendValue(_recipient, _amount);
        emit ETHWithdrawed(msg.sender, _recipient, _amount);
    }

    modifier onlyInvestor() {
        if (msg.sender != investor) revert CallerIsNotInvestor();
        _;
    }
}
