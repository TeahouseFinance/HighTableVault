# HighTableVault

HighTableVault is a ledger system designed for manually managed funds, where adding to the funds or liquidate from the funds can't happen automatically on chain.

## Introduction

HighTableVault works with TeaVaultV2 for fund management.

The vault works in cycles. Investors may request deposits or withdrawals during each cycle, and the auditor, working with fund manager, ends a cycle by processing all requests at the same time and entering the next cycle. Total vaule of the fund is assigned only at the end of a cycle.

The fund is based on one asset token, which must be an ERC20 token. The vault itself is an ERC20 token too, as shares of the fund. If WETH is used, an extension to the vault called HighTableVaultETH can be used to allow investors to invest directly in native token (e.g. Ethereum), which will be wrapped and unwrapped automatically.

HighTableVault may be set up with one or more gating NFT, where only investors with these NFT may invest into the vault.

### Roles

#### Administrator (`DEFAULT_ADMIN_ROLE`)

* Set up vault
* Setting fee structures
* Assign TeaVaultV2 contract

#### Auditor (`AUDITOR_ROLE`)

* Manage cycles
* Enable/disable deposits and/or withdrawals
* Deposit or withdraw to the TeaVaultV2, if necessary

### Life cycle

HighTableVault works in cycles.

#### Initial cycle

* The vault is set up with an initial price for shares
* Investors may request deposits with asset tokens
* Optionally, investors may cancel deposits
* Auditor enters the next cycle
* The asset tokens are deposited into TeaVaultV2 automatically
* Share tokens are minted and made available for investors to claim
* Manager manages the fund through TeaVaultV2 with the asset tokens

#### Ordinary cycle

* Investors may claim the tokens resulting from requests in the previous cycle (including asset tokens from withdrawals and share tokens from deposits)
* Investors may request further deposits with asset tokens
* Investors may request withdrawals with share tokens
* Optionally, investor may cancel deposits and withdrawals, getting tokens back immediately
* After fund locking time, requests for and canceling deposits and withdrawals are disabled
* Manager calculates the total value of the fund, and preview the required amount of assets token to be withdrawn
* The preview function automatically factors deposits in so unnecessary liquidations can be avoided
* Manager liquidates part of the fund to get enough asset tokens for withdrawal requests
* Auditor confirms the value of the fund and the amount required for withdrawal requests, and enters the next cycle
* Share tokens from withdrawal requests are burned and the resulting asset tokens are made available for investors to claim
* The remaining asset tokens from deposit requests are deposited into TeaVaultV2, and share tokens are minted and made available for investors to claim

#### Closing cycle

* If the auditor elected to close the fund when entering the next cycle, it enters the closing cycle (this is irreversible)
* Manager should liquidate the entire fund back to asset tokens before closing
* All assets tokens are withdrawn from TeaVaultV2 back to HighTableVault
* Requests for deposits and withdrawals are disabled as there will be no further cycles
* All investors with share tokens may close their positions by burning the share tokens and claim asset tokens immediately

## Set up

This project uses hardhat.

Use `npm install` to install required packages.

Copy `.env.example` into `.env` and add necessary settings.

Run `npx hardhat test` to run unit tests.

The scripts `deploy.ts` and `deployETH.ts` are sample scripts for deploying the contracts. 
