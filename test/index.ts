import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import {
    HighTableVault,
    HighTableVaultETH,
    MockERC721,
    MockERC20,
    MockWETH9,
    MockTeaVaultV2
} from "../typechain";

const parseEther = ethers.utils.parseEther;

async function getGas(hash: string): Promise<BigNumber> {
    let receipt = await ethers.provider.getTransactionReceipt(hash);
    return receipt.effectiveGasPrice.mul(receipt.gasUsed);
}

describe("HighTableVault", function () {

    let admin: SignerWithAddress; // owner address
    let user: SignerWithAddress; // user address (has OG)
    let user2: SignerWithAddress; // second user address (has OG)
    let user3: SignerWithAddress; // third user address (has VIP)
    let user4: SignerWithAddress; // fourth user address (has nothing)
    let auditor: SignerWithAddress; // auditor address
    let platformVault: SignerWithAddress; // platform vault address
    let managerVault: SignerWithAddress; // manager vault address

    let htVault: HighTableVault;
    let nftOG: MockERC721;
    let nftVIP: MockERC721;
    let erc20: MockERC20;
    let teaVault: MockTeaVaultV2;

    beforeEach(async function () {
        [admin, user, user2, user3, user4, auditor, platformVault, managerVault] = await ethers.getSigners();

        // deploy
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        erc20 = await MockERC20.deploy(parseEther("20000000"));

        const NFT = await ethers.getContractFactory("MockERC721");
        nftOG = await NFT.deploy();
        nftVIP = await NFT.deploy();

        const block = await ethers.provider.getBlock('latest');
        const HTVault = await ethers.getContractFactory("HighTableVault");
        htVault = await HTVault.deploy("Test Vault #1", "NFT1", erc20.address, 100, 1, block.timestamp, admin.address);

        const AUDITOR_ROLE = await htVault.AUDITOR_ROLE();
        let tx = await htVault.grantRole(AUDITOR_ROLE, auditor.address);
        await tx.wait();

        const feeConfig = {
            platformVault: platformVault.address,
            managerVault: managerVault.address,
            platformEntryFee: 300,
            managerEntryFee: 700,
            platformExitFee: 600,
            managerExitFee: 1400,
            platformPerformanceFee: 10000,
            managerPerformanceFee: 90000,
            platformManagementFee: 2000,
            managerManagementFee: 8000
        };
        tx = await htVault.setFeeConfig(feeConfig);
        await tx.wait();

        const TeaVault = await ethers.getContractFactory("MockTeaVaultV2");
        teaVault = await TeaVault.deploy(htVault.address);

        tx = await htVault.setTeaVaultV2(teaVault.address);
        await tx.wait();

        tx = await htVault.setEnabledNFTs([nftOG.address]);
        await tx.wait();        

        const timestamp = Math.floor((new Date()).getTime() / 1000);
        tx = await htVault.connect(auditor).setFundLockingTimestamp(timestamp + 1000);
        await tx.wait();

        tx = await htVault.connect(auditor).setDepositLimit(parseEther("10000"));
        await tx.wait();

        // transfer some tokens to user accounts
        tx = await erc20.transfer(user.address, parseEther("10000000"));
        await tx.wait();
        tx = await erc20.transfer(user2.address, parseEther("100000"));
        await tx.wait();
        tx = await erc20.transfer(user3.address, parseEther("1000"));
        await tx.wait();
        tx = await erc20.transfer(user4.address, parseEther("1000"));
        await tx.wait();

        // mint some nft
        tx = await nftOG.connect(user).mint(user.address);
        await tx.wait();
        tx = await nftOG.connect(user2).mint(user2.address);
        await tx.wait();
        tx = await nftVIP.connect(user3).mint(user3.address);
        await tx.wait();
    });

    it("Test assets", async function() {
        const assetToken = await htVault.asset();
        expect(assetToken).to.equal(erc20.address);
    });

    it("Test setEnabledNFTs", async function () {
        // should fail from non-admin
        await expect(htVault.connect(user).setEnabledNFTs([nftOG.address])).to.be.revertedWithCustomError(htVault, "OnlyAvailableToAdmins");

        // set NFT
        let tx = await htVault.setEnabledNFTs([nftOG.address, nftVIP.address]);
        await tx.wait();

        // verify if NFT are set
        expect(await htVault.nftEnabled(0)).to.equal(nftOG.address);
        expect(await htVault.nftEnabled(1)).to.equal(nftVIP.address);
        await expect(htVault.nftEnabled(2)).to.be.reverted;

        // test requestDeposits from user with OG
        tx = await erc20.connect(user).approve(htVault.address, parseEther("100"));
        await tx.wait();
        tx = await htVault.connect(user).requestDeposit(parseEther("100"), user.address);
        await tx.wait();

        // test requestDeposits from user with VIP
        tx = await erc20.connect(user3).approve(htVault.address, parseEther("100"));
        await tx.wait();
        tx = await htVault.connect(user3).requestDeposit(parseEther("100"), user3.address);
        await tx.wait();

        // test requestDeposits from user with no NFT
        tx = await erc20.connect(user4).approve(htVault.address, parseEther("100"));
        await tx.wait();
        await expect(htVault.connect(user4).requestDeposit(parseEther("100"), user4.address)).to.be.revertedWithCustomError(htVault, "ReceiverDoNotHasNFT");

        // test receiver address differ from caller
        tx = await erc20.connect(user).approve(htVault.address, parseEther("100"));
        await tx.wait();
        await expect(htVault.connect(user).requestDeposit(parseEther("100"), user4.address)).to.be.revertedWithCustomError(htVault, "ReceiverDoNotHasNFT");

        tx = await erc20.connect(user4).approve(htVault.address, parseEther("100"));
        await tx.wait();
        tx = await htVault.connect(user4).requestDeposit(parseEther("100"), user.address);
        await tx.wait();
    });

    it("Test disableNFTChecks", async function () {
        // should fail from non-admin
        await expect(htVault.connect(user).setDisableNFTChecks(false)).to.be.revertedWithCustomError(htVault, "OnlyAvailableToAdmins");

        // disable NFT checks
        let tx = await htVault.setDisableNFTChecks(true);
        await tx.wait();

        // verify
        expect((await htVault.fundConfig()).disableNFTChecks).to.equal(true);

        // test requestDeposits from user with OG
        tx = await erc20.connect(user).approve(htVault.address, parseEther("100"));
        await tx.wait();
        tx = await htVault.connect(user).requestDeposit(parseEther("100"), user.address);
        await tx.wait();

        // test requestDeposits from user with VIP
        tx = await erc20.connect(user3).approve(htVault.address, parseEther("100"));
        await tx.wait();
        tx = await htVault.connect(user3).requestDeposit(parseEther("100"), user3.address);
        await tx.wait();

        // test requestDeposits from user with no NFT
        tx = await erc20.connect(user4).approve(htVault.address, parseEther("100"));
        await tx.wait();
        tx = await htVault.connect(user4).requestDeposit(parseEther("100"), user4.address);
        await tx.wait();

        // test receiver address differ from caller
        tx = await erc20.connect(user4).approve(htVault.address, parseEther("100"));
        await tx.wait();
        tx = await htVault.connect(user4).requestDeposit(parseEther("100"), user.address);
        await tx.wait();

        tx = await erc20.connect(user).approve(htVault.address, parseEther("100"));
        await tx.wait();
        tx = await htVault.connect(user).requestDeposit(parseEther("100"), user4.address);
        await tx.wait();        
    });

    it("Test setFeeConfig", async function () {
        const feeConfig = {
            platformVault: managerVault.address,
            managerVault: platformVault.address,
            platformEntryFee: 100,
            managerEntryFee: 200,
            platformExitFee: 200,
            managerExitFee: 400,
            platformPerformanceFee: 1000,
            managerPerformanceFee: 2000,
            platformManagementFee: 300,
            managerManagementFee: 400
        };

        // should fail from non-admin
        await expect(htVault.connect(user).setFeeConfig(feeConfig)).to.be.revertedWithCustomError(htVault, "OnlyAvailableToAdmins");

        // set feeConfig
        const tx = await htVault.setFeeConfig(feeConfig);
        await tx.wait();

        // verify results
        const results = await htVault.feeConfig();
        expect(results.platformVault).to.equal(feeConfig.platformVault);
        expect(results.managerVault).to.equal(feeConfig.managerVault);
        expect(results.platformEntryFee).to.equal(feeConfig.platformEntryFee);
        expect(results.managerEntryFee).to.equal(feeConfig.managerEntryFee);
        expect(results.platformExitFee).to.equal(feeConfig.platformExitFee);
        expect(results.managerExitFee).to.equal(feeConfig.managerExitFee);
        expect(results.platformPerformanceFee).to.equal(feeConfig.platformPerformanceFee);
        expect(results.managerPerformanceFee).to.equal(feeConfig.managerPerformanceFee);
        expect(results.platformManagementFee).to.equal(feeConfig.platformManagementFee);
        expect(results.managerManagementFee).to.equal(feeConfig.managerManagementFee);
    });

    it("Test setTeaVaultV2", async function () {
        // should fail from non-admin
        await expect(htVault.connect(user).setTeaVaultV2(platformVault.address)).to.be.revertedWithCustomError(htVault, "OnlyAvailableToAdmins");

        // set TeaVaultV2 address
        const tx = await htVault.setTeaVaultV2(platformVault.address);
        await tx.wait();

        // verify
        expect((await htVault.fundConfig()).teaVaultV2).to.equal(platformVault.address);
    });

    it("Test setFundLockingTimestamp", async function () {
        const timestamp = Math.floor((new Date()).getTime() / 1000);

        // should fail from non-auditor
        await expect(htVault.connect(user).setFundLockingTimestamp(timestamp + 100)).to.be.revertedWithCustomError(htVault, "OnlyAvailableToAuditors");

        // set fund locking timestamp to the future
        let tx = await htVault.connect(auditor).setFundLockingTimestamp(timestamp + 1000);
        await tx.wait();

        // verify
        expect((await htVault.globalState()).fundingLockTimestamp).to.equal(timestamp + 1000);

        // test requestDeposits
        tx = await erc20.connect(user).approve(htVault.address, parseEther("100"));
        await tx.wait();
        tx = await htVault.connect(user).requestDeposit(parseEther("100"), user.address);
        await tx.wait();

        // set fund locking timestamp to the past
        tx = await htVault.connect(auditor).setFundLockingTimestamp(timestamp - 1000);
        await tx.wait();

        // verify
        expect((await htVault.globalState()).fundingLockTimestamp).to.equal(timestamp - 1000);

        // test requestDeposits
        tx = await erc20.connect(user).approve(htVault.address, parseEther("100"));
        await tx.wait();
        await expect(htVault.connect(user).requestDeposit(parseEther("100"), user.address)).to.be.revertedWithCustomError(htVault, "FundingLocked");

        // enter next cycle to test withdraw
        // set fund locking timestamp to the past
        const block = await ethers.provider.getBlock(tx.blockNumber || 0);
        tx = await htVault.connect(auditor).enterNextCycle(0, parseEther("100"), parseEther("0"), parseEther("0"), block.timestamp, timestamp - 1000, false);
        await tx.wait();

        // claim owed shares for requesting withdraw
        tx = await htVault.connect(user).claimOwedShares(user.address);
        await tx.wait();

        // test requestWithdraw
        const balance = await htVault.balanceOf(user.address);
        await expect(htVault.connect(user).requestWithdraw(balance, user.address)).to.be.revertedWithCustomError(htVault, "FundingLocked");

        // set fund locking timestamp to the future
        tx = await htVault.connect(auditor).setFundLockingTimestamp(timestamp + 1000);
        await tx.wait();

        // verify
        expect((await htVault.globalState()).fundingLockTimestamp).to.equal(timestamp + 1000);

        // test requestWithdraw
        tx = await htVault.connect(user).requestWithdraw(balance, user.address);
        await tx.wait();
    });

    it("Test setDepositLimit", async function () {
        const depositLimit = parseEther("100");
        // should fail from non-auditor
        await expect(htVault.connect(user).setDepositLimit(depositLimit)).to.be.revertedWithCustomError(htVault, "OnlyAvailableToAuditors");

        // set deposit limit
        let tx = await htVault.connect(auditor).setDepositLimit(depositLimit);
        await tx.wait();

        // verify
        expect((await htVault.globalState()).depositLimit).to.equal(depositLimit);

        // request deposit more than limit in one go
        tx = await erc20.connect(user).approve(htVault.address, parseEther("10000"));
        await tx.wait();
        await expect(htVault.connect(user).requestDeposit(parseEther("10000"), user.address)).to.be.revertedWithCustomError(htVault, "ExceedDepositLimit");

        // request deposit less than limit
        tx = await htVault.connect(user).requestDeposit(parseEther("99"), user.address);
        await tx.wait();

        // request again to exceed the limit
        await expect(htVault.connect(user).requestDeposit(parseEther("99"), user.address)).to.be.revertedWithCustomError(htVault, "ExceedDepositLimit");
    });

    it("Test setDisableFunding", async function () {
        // should fail from non-auditor
        await expect(htVault.connect(user).setDisableFunding(true, true, true, true)).to.be.revertedWithCustomError(htVault, "OnlyAvailableToAuditors");

        // enable both funding and canceling
        let tx = await htVault.connect(auditor).setDisableFunding(false, false, false, false);
        await tx.wait();

        // verify
        let config = await htVault.fundConfig();
        expect(config.disableDepositing).to.equal(false);
        expect(config.disableWithdrawing).to.equal(false);
        expect(config.disableCancelDepositing).to.equal(false);
        expect(config.disableCancelWithdrawing).to.equal(false);

        // test requestDeposits
        tx = await erc20.connect(user).approve(htVault.address, parseEther("10000"));
        await tx.wait();
        tx = await htVault.connect(user).requestDeposit(parseEther("100"), user.address);
        await tx.wait();

        // test cancelDeposit
        tx = await htVault.connect(user).cancelDeposit(parseEther("10"), user.address);
        await tx.wait();

        // enter next cycle to test withdraw
        const block = await ethers.provider.getBlock(tx.blockNumber || 0);
        tx = await htVault.connect(auditor).enterNextCycle(0, parseEther("100"), parseEther("200"), parseEther("0"), block.timestamp, block.timestamp + 1000, false);
        await tx.wait();

        // claim owed shares for requesting withdraw
        tx = await htVault.connect(user).claimOwedShares(user.address);
        await tx.wait();

        // test requestWithdraw
        let balance = await htVault.balanceOf(user.address);
        tx = await htVault.connect(user).requestWithdraw(balance, user.address);
        await tx.wait();

        // test cancelWithdraw
        tx = await htVault.connect(user).cancelWithdraw(balance, user.address);
        await tx.wait();

        // disable both funding
        tx = await htVault.connect(auditor).setDisableFunding(true, true, false, false);
        await tx.wait();

        // verify
        config = await htVault.fundConfig();
        expect(config.disableDepositing).to.equal(true);
        expect(config.disableWithdrawing).to.equal(true);
        expect(config.disableCancelDepositing).to.equal(false);
        expect(config.disableCancelWithdrawing).to.equal(false);

        // test requestDeposits
        await expect(htVault.connect(user).requestDeposit(parseEther("100"), user.address)).to.be.revertedWithCustomError(htVault, "DepositDisabled");

        // test requestWithdraw
        balance = await htVault.balanceOf(user.address);
        await expect(htVault.connect(user).requestWithdraw(balance, user.address)).to.be.revertedWithCustomError(htVault, "WithdrawDisabled");

        // disable both canceling
        tx = await htVault.connect(auditor).setDisableFunding(false, false, true, true);
        await tx.wait();

        // verify
        config = await htVault.fundConfig();
        expect(config.disableDepositing).to.equal(false);
        expect(config.disableWithdrawing).to.equal(false);
        expect(config.disableCancelDepositing).to.equal(true);
        expect(config.disableCancelWithdrawing).to.equal(true);

        // test requestDeposits
        tx = await erc20.connect(user).approve(htVault.address, parseEther("10000"));
        await tx.wait();
        tx = await htVault.connect(user).requestDeposit(parseEther("100"), user.address);
        await tx.wait();

        // test requestWithdraw
        balance = await htVault.balanceOf(user.address);
        tx = await htVault.connect(user).requestWithdraw(balance, user.address);
        await tx.wait();

        // test cancelDeposit
        await expect(htVault.connect(user).cancelDeposit(parseEther("100"), user.address)).to.be.revertedWithCustomError(htVault, "CancelDepositDisabled");

        // test cancelWithdraw
        await expect(htVault.connect(user).cancelWithdraw(balance, user.address)).to.be.revertedWithCustomError(htVault, "CancelWithdrawDisabled");
    });

    it("Test depositToVault", async function () {
        // transfer some tokens to HighTableVault
        let tx = await erc20.transfer(htVault.address, parseEther("100"));
        await tx.wait();

        // should fail from non-auditor
        await expect(htVault.connect(user).depositToVault(parseEther("100"))).to.be.revertedWithCustomError(htVault, "OnlyAvailableToAuditors");

        // deposit
        const beforeHTBalance = await erc20.balanceOf(htVault.address);
        const beforeTVBalance = await erc20.balanceOf(teaVault.address);
        tx = await htVault.connect(auditor).depositToVault(parseEther("100"));
        await tx.wait();
        const afterHTBalance = await erc20.balanceOf(htVault.address);
        const afterTVBalance = await erc20.balanceOf(teaVault.address);

        // verify
        expect(beforeHTBalance.sub(afterHTBalance)).to.equal(parseEther("100"));
        expect(afterTVBalance.sub(beforeTVBalance)).to.equal(parseEther("100"));
    });

    it("Test withdrawFromVault", async function () {
        // transfer some tokens to TeaVault
        let tx = await erc20.transfer(teaVault.address, parseEther("100"));
        await tx.wait();

        // should fail from non-auditor
        await expect(htVault.connect(user).withdrawFromVault(parseEther("100"))).to.be.revertedWithCustomError(htVault, "OnlyAvailableToAuditors");

        // withdraw
        const beforeHTBalance = await erc20.balanceOf(htVault.address);
        const beforeTVBalance = await erc20.balanceOf(teaVault.address);
        tx = await htVault.connect(auditor).withdrawFromVault(parseEther("100"));
        await tx.wait();
        const afterHTBalance = await erc20.balanceOf(htVault.address);
        const afterTVBalance = await erc20.balanceOf(teaVault.address);

        // verify
        expect(afterHTBalance.sub(beforeHTBalance)).to.equal(parseEther("100"));
        expect(beforeTVBalance.sub(afterTVBalance)).to.equal(parseEther("100"));
    });
    
    it("Test enterNextCycle", async function () {
        // set fee
        const feeConfig = {
            platformVault: platformVault.address,
            managerVault: managerVault.address,
            platformEntryFee: 300,
            managerEntryFee: 700,
            platformExitFee: 600,
            managerExitFee: 1400,
            platformPerformanceFee: 10000,
            managerPerformanceFee: 90000,
            platformManagementFee: 2000,
            managerManagementFee: 8000
        };
        let tx = await htVault.setFeeConfig(feeConfig);
        await tx.wait();

        // deposit from users
        tx = await erc20.connect(user).approve(htVault.address, parseEther("300"));
        await tx.wait();

        tx = await htVault.connect(user).requestDeposit(parseEther("100"), user.address);
        await tx.wait();

        tx = await erc20.connect(user2).approve(htVault.address, parseEther("400"));
        await tx.wait();

        tx = await htVault.connect(user2).requestDeposit(parseEther("200"), user2.address);
        await tx.wait();

        // should fail from non-auditor
        let block = await ethers.provider.getBlock(tx.blockNumber || 0);
        await expect(htVault.connect(user).enterNextCycle(
            0, 
            parseEther("0"), 
            parseEther("10000"),
            parseEther("0"),
            block.timestamp,
            block.timestamp + 1000,
            false
        )).to.be.revertedWithCustomError(htVault, "OnlyAvailableToAuditors");

        // enter cycle with timestamp before initialization
        await expect(htVault.connect(auditor).enterNextCycle(
            0, 
            parseEther("0"), 
            parseEther("10000"),
            parseEther("0"),
            block.timestamp - 1000,
            block.timestamp + 1000,
            false
        )).to.be.revertedWithCustomError(htVault, "IncorrectCycleStartTimestamp");

        // enter cycle with timestamp later than block time
        await expect(htVault.connect(auditor).enterNextCycle(
            0, 
            parseEther("0"), 
            parseEther("10000"),
            parseEther("0"),
            block.timestamp + 1000,
            block.timestamp + 2000,
            false
        )).to.be.revertedWithCustomError(htVault, "IncorrectCycleStartTimestamp");

        // enter cycle #1
        tx = await htVault.connect(auditor).enterNextCycle(
            0,
            parseEther("0"),
            parseEther("10000"),
            parseEther("0"),
            block.timestamp,
            block.timestamp + 1000,
            false
        );
        await tx.wait();

        // try to enter cycle #1 again
        await expect(htVault.connect(auditor).enterNextCycle(
            0,
            parseEther("0"),
            parseEther("10000"),
            parseEther("0"),
            block.timestamp,
            block.timestamp + 1000,
            false
        )).to.be.revertedWithCustomError(htVault, "IncorrectCycleIndex");

        // try to enter cycle #3
        await expect(htVault.connect(auditor).enterNextCycle(
            2,
            parseEther("0"),
            parseEther("10000"),
            parseEther("0"),
            block.timestamp,
            block.timestamp + 1000,
            false
        )).to.be.revertedWithCustomError(htVault, "IncorrectCycleIndex");

        // verify platform vault balance and manager vault balance
        expect(await erc20.balanceOf(platformVault.address)).to.equal(parseEther("0.09"));
        expect(await erc20.balanceOf(managerVault.address)).to.equal(parseEther("0.21"));

        // verify globalState
        let globalState = await htVault.globalState();
        expect(globalState.cycleIndex).to.equal(1);
        expect(globalState.cycleStartTimestamp).to.equal(block.timestamp);
        expect(globalState.fundingLockTimestamp).to.equal(block.timestamp + 1000);

        // verify cycleState
        let cycleState = await htVault.cycleState(0);
        expect(cycleState.totalFundValue).to.equal(0);
        expect(cycleState.fundValueAfterRequests).to.equal(parseEther("299.7"));    // 0.1% entry fee
        expect(cycleState.requestedDeposits).to.equal(parseEther("300"));
        expect(cycleState.convertedDeposits).to.equal(parseEther("2.997"));
        expect(cycleState.requestedWithdrawals).to.equal(0);
        expect(cycleState.convertedWithdrawals).to.equal(0);

        // claim
        let shares = await htVault.connect(user).callStatic.claimOwedShares(user.address);
        expect(shares).to.equal(parseEther("0.999"));                               // 0.1% entry fee

        shares = await htVault.connect(user2).callStatic.claimOwedShares(user2.address);
        expect(shares).to.equal(parseEther("1.998"));                               // 0.1% entry fee

        tx = await htVault.connect(user).claimOwedShares(user.address);
        await tx.wait();

        expect(await htVault.balanceOf(user.address)).to.equal(parseEther("0.999"));        // 0.1% entry fee

        shares = await htVault.connect(user).callStatic.claimOwedShares(user.address);
        expect(shares).to.equal(0);

        // claim again, balance should not change
        tx = await htVault.connect(user).claimOwedShares(user.address);
        await tx.wait();
        expect(await htVault.balanceOf(user.address)).to.equal(parseEther("0.999")); 

        // request withdraw
        tx = await htVault.connect(user).requestWithdraw(parseEther("0.99"), user.address);
        await tx.wait();

        // request deposit again without withdrawal
        tx = await htVault.connect(user2).requestDeposit(parseEther("100"), user2.address);
        await tx.wait();

        // enter next cycle again
        // transfer some token to teavault
        tx = await erc20.transfer(teaVault.address, parseEther("100"));
        await tx.wait();

        globalState = await htVault.globalState();
        let balance = await erc20.balanceOf(htVault.address);
        expect(balance).to.equal(globalState.lockedAssets);

        let cycleStartTimestamp = globalState.cycleStartTimestamp;

        block = await ethers.provider.getBlock(tx.blockNumber || 0);
        let newFundValue = parseEther("400");
        let withdrawAmount = await htVault.previewNextCycle(newFundValue, block.timestamp);
        let platformBalance = await erc20.balanceOf(platformVault.address);
        let managerBalance = await erc20.balanceOf(managerVault.address);
        tx = await htVault.connect(auditor).enterNextCycle(
            1,
            newFundValue,
            parseEther("10000"),
            withdrawAmount,
            block.timestamp,
            block.timestamp + 1000,
            false
        );
        await tx.wait();

        let timeDiff = block.timestamp - cycleStartTimestamp.toNumber();

        // calculate performance fees
        let profit = newFundValue.sub(parseEther("299.7"));
        let platformPerformanceFee = profit.div(100);             // 1% performance fee
        let managerPerformanceFee = profit.mul(9).div(100);       // 9% performance fee

        // calculate management fees
        let platformManagementFee = newFundValue.mul(2).mul(timeDiff).div(1000 * 365 * 86400);    // 0.2% yearly management fee
        let managerManagementFee = newFundValue.mul(8).mul(timeDiff).div(1000 * 365 * 86400);     // 0.8% yearly management fee

        // substrate performance fees and management fees from new fund value
        newFundValue = newFundValue.sub(platformPerformanceFee).sub(managerPerformanceFee).sub(platformManagementFee).sub(managerManagementFee);

        // calculate withdrawal fees
        let totalSupply = parseEther("2.997");
        let convertedWithdrawals = parseEther("0.99").mul(newFundValue).div(totalSupply);
        let platformExitFee = convertedWithdrawals.mul(6).div(10000);     // 0.06% exit fee
        let managerExitFee = convertedWithdrawals.mul(14).div(10000);     // 0.14% exit fee

        // calculate entry fees
        let newDeposits = parseEther("100");
        let platformEntryFee = newDeposits.mul(3).div(10000);     // 0.03% entry fee
        let managerEntryFee = newDeposits.mul(7).div(10000);      // 0.07% entry fee
        let convertedDeposits = newDeposits.sub(platformEntryFee).sub(managerEntryFee).mul(totalSupply).div(newFundValue);

        // verify owed assets and shares are correct
        let assets = await htVault.connect(user).callStatic.claimOwedAssets(user.address);
        expect(assets).to.equal(convertedWithdrawals.sub(platformExitFee).sub(managerExitFee));

        // verify owed shares are correct
        shares = await htVault.connect(user2).callStatic.claimOwedShares(user2.address);
        expect(shares).to.equal(convertedDeposits.add(parseEther("1.998")));

        // calculate and verify total fees received by platform and manager
        const totalPlatformFee = platformPerformanceFee.add(platformManagementFee).add(platformExitFee).add(platformEntryFee);
        const totalManagerFee = managerPerformanceFee.add(managerManagementFee).add(managerExitFee).add(managerEntryFee);
        expect((await erc20.balanceOf(platformVault.address)).sub(platformBalance)).to.equal(totalPlatformFee);
        expect((await erc20.balanceOf(managerVault.address)).sub(managerBalance)).to.equal(totalManagerFee);

        // verify total supply
        let newTotalSupply = parseEther("2.997").add(convertedDeposits).sub(parseEther("0.99"));
        expect(await htVault.totalSupply()).to.equal(newTotalSupply);

        // request withdraw again without withdrawl
        tx = await htVault.connect(user).requestWithdraw(parseEther("0.009"), user.address);
        await tx.wait();

        // test entering next cycle again
        block = await ethers.provider.getBlock(tx.blockNumber || 0);
        globalState = await htVault.globalState();
        cycleStartTimestamp = globalState.cycleStartTimestamp
        timeDiff = block.timestamp - cycleStartTimestamp.toNumber();
        newFundValue = parseEther("300");
        withdrawAmount = await htVault.previewNextCycle(newFundValue, block.timestamp);
        let results = await htVault.connect(auditor).callStatic.enterNextCycle(
            2,
            newFundValue,
            parseEther("10000"),
            withdrawAmount,
            block.timestamp,
            block.timestamp + 1000,
            false
        );

        // no performance fee, calculate management fee
        platformManagementFee = newFundValue.mul(2).mul(timeDiff).div(1000 * 365 * 86400);    // 0.2% yearly management fee
        managerManagementFee = newFundValue.mul(8).mul(timeDiff).div(1000 * 365 * 86400);     // 0.8% yearly management fee

        // substrate management fees from new fund value
        newFundValue = newFundValue.sub(platformManagementFee).sub(managerManagementFee);

        // no entry fee, calculate exit fee
        convertedWithdrawals = parseEther("0.009").mul(newFundValue).div(newTotalSupply);
        platformExitFee = convertedWithdrawals.mul(6).div(10000);     // 0.06% exit fee
        managerExitFee = convertedWithdrawals.mul(14).div(10000);     // 0.14% exit fee

        // verify fees
        expect(results.platformFee).to.equal(platformManagementFee.add(platformExitFee));
        expect(results.managerFee).to.equal(managerManagementFee.add(managerExitFee));

        // actually enter next cycle
        tx = await htVault.connect(auditor).enterNextCycle(
            2,
            parseEther("300"),
            parseEther("10000"),
            withdrawAmount,
            block.timestamp,
            block.timestamp + 1000,
            false
        );
        await tx.wait();

        // claim
        let newAssets = await htVault.connect(user).callStatic.claimOwedAssets(user.address);
        expect(newAssets).to.equal(convertedWithdrawals.sub(platformExitFee).sub(managerExitFee).add(assets));

        // deposit and withdraw before closing
        balance = await erc20.balanceOf(user.address);
        tx = await htVault.connect(user).claimAndRequestDeposit(parseEther("100"), user.address);
        await tx.wait();
        expect((await erc20.balanceOf(user.address)).sub(balance)).to.equal(newAssets.sub(parseEther("100")));

        // verify there's no assets other than the new deposit remaining in the vault
        balance = await erc20.balanceOf(htVault.address);
        globalState = await htVault.globalState();
        expect(balance).to.equal(parseEther("100"));
        expect(globalState.lockedAssets).to.equal(balance);        

        tx = await htVault.connect(user2).claimAndRequestWithdraw(parseEther("1"), user2.address);
        await tx.wait();

        // close fund
        block = await ethers.provider.getBlock(tx.blockNumber || 0);
        globalState = await htVault.globalState();
        cycleStartTimestamp = globalState.cycleStartTimestamp
        timeDiff = block.timestamp - cycleStartTimestamp.toNumber();
        balance = await erc20.balanceOf(teaVault.address);
        results = await htVault.connect(auditor).callStatic.enterNextCycle(
            3,
            balance,
            parseEther("0"),
            balance,
            block.timestamp,
            block.timestamp + 1000,
            true
        );

        platformBalance = await erc20.balanceOf(platformVault.address);
        managerBalance = await erc20.balanceOf(managerVault.address);
        totalSupply = await htVault.totalSupply();
        tx = await htVault.connect(auditor).enterNextCycle(
            3,
            balance,
            parseEther("0"),
            balance,
            block.timestamp,
            block.timestamp + 1000,
            true
        );
        await tx.wait();

        globalState = await htVault.globalState();
        expect(await erc20.balanceOf(htVault.address)).to.equal(globalState.lockedAssets);

        // calculate performance fee
        cycleState = await htVault.cycleState(2);
        profit = balance.sub(cycleState.fundValueAfterRequests);
        platformPerformanceFee = profit.div(100);             // 1% performance fee
        managerPerformanceFee = profit.mul(9).div(100);       // 9% performance fee        

        // calculate management fee
        platformManagementFee = balance.mul(2).mul(timeDiff).div(1000 * 365 * 86400);    // 0.2% yearly management fee
        managerManagementFee = balance.mul(8).mul(timeDiff).div(1000 * 365 * 86400);     // 0.8% yearly management fee
        
        // calculate entry fee
        newDeposits = parseEther("100");
        platformEntryFee = newDeposits.mul(3).div(10000);     // 0.03% entry fee
        managerEntryFee = newDeposits.mul(7).div(10000);      // 0.07% entry fee

        // calculate exit fee
        // has to calculate requested withdrawal separately to avoid rounding errors
        newFundValue = balance.sub(platformManagementFee).sub(managerManagementFee).sub(platformPerformanceFee).sub(managerPerformanceFee);
        convertedWithdrawals = parseEther("1").mul(newFundValue).div(totalSupply);
        platformExitFee = convertedWithdrawals.mul(6).div(10000);     // 0.06% exit fee
        managerExitFee = convertedWithdrawals.mul(14).div(10000);     // 0.14% exit fee
        let remainingWithdrawals = newFundValue.add(newDeposits).sub(platformEntryFee).sub(managerEntryFee).sub(convertedWithdrawals);
        platformExitFee = platformExitFee.add(remainingWithdrawals.mul(6).div(10000));      // 0.06% exit fee
        managerExitFee = managerExitFee.add(remainingWithdrawals.mul(14).div(10000));       // 0.14% exit fee

        // requests should fail after fund closed
        await expect(htVault.connect(user).requestDeposit(parseEther("100"), user.address)).to.be.revertedWithCustomError(htVault, "FundIsClosed");
        await expect(htVault.connect(user2).requestWithdraw(parseEther("0.1"), user2.address)).to.be.revertedWithCustomError(htVault, "FundIsClosed");

        // close position
        balance = await erc20.balanceOf(user.address);
        tx = await htVault.connect(user).closePositionAndClaim(user.address);
        await tx.wait();

        let balance2 = await erc20.balanceOf(user2.address);
        tx = await htVault.connect(user2).closePositionAndClaim(user2.address);
        await tx.wait();

        balance = (await erc20.balanceOf(user.address)).sub(balance);
        balance2 = (await erc20.balanceOf(user2.address)).sub(balance2);

        let totalWithdrawn = convertedWithdrawals.add(remainingWithdrawals).sub(platformExitFee).sub(managerExitFee);
        expect(balance.add(balance2).sub(totalWithdrawn).abs().toNumber()).to.lessThanOrEqual(1);

        // verify fees received by platformVault and managerVault
        platformBalance = (await erc20.balanceOf(platformVault.address)).sub(platformBalance);
        managerBalance = (await erc20.balanceOf(managerVault.address)).sub(managerBalance);
        expect(platformPerformanceFee.add(platformManagementFee).add(platformEntryFee).add(platformExitFee)).to.equal(platformBalance);
        expect(managerPerformanceFee.add(managerManagementFee).add(managerEntryFee).add(managerExitFee)).to.equal(managerBalance);
    });

    it("Test enterNextCycle with no actions between cycles", async function () {
        // set fee
        const feeConfig = {
            platformVault: platformVault.address,
            managerVault: managerVault.address,
            platformEntryFee: 300,
            managerEntryFee: 700,
            platformExitFee: 600,
            managerExitFee: 1400,
            platformPerformanceFee: 10000,
            managerPerformanceFee: 90000,
            platformManagementFee: 2000,
            managerManagementFee: 8000
        };
        let tx = await htVault.setFeeConfig(feeConfig);
        await tx.wait();

        // deposit from users
        tx = await erc20.connect(user).approve(htVault.address, parseEther("300"));
        await tx.wait();

        tx = await htVault.connect(user).requestDeposit(parseEther("100"), user.address);
        await tx.wait();

        tx = await erc20.connect(user2).approve(htVault.address, parseEther("400"));
        await tx.wait();

        tx = await htVault.connect(user2).requestDeposit(parseEther("200"), user2.address);
        await tx.wait();

        // enter cycle #1
        let block = await ethers.provider.getBlock(tx.blockNumber || 0);
        tx = await htVault.connect(auditor).enterNextCycle(
            0,
            parseEther("0"),
            parseEther("10000"),
            parseEther("0"),
            block.timestamp,
            block.timestamp + 1000,
            false
        );
        await tx.wait();

        // enter cycle #2
        let newFundValue = parseEther("350");
        block = await ethers.provider.getBlock(tx.blockNumber || 0);
        let withdrawAmount = await htVault.previewNextCycle(newFundValue, block.timestamp);
        tx = await htVault.connect(auditor).enterNextCycle(
            1,
            newFundValue,
            parseEther("10000"),
            withdrawAmount,
            block.timestamp,
            block.timestamp + 1000,
            false
        );
        await tx.wait();        
    });

    it("Test enterNextCycle with all funds withdrawn", async function () {
        // set fee
        const feeConfig = {
            platformVault: platformVault.address,
            managerVault: managerVault.address,
            platformEntryFee: 300,
            managerEntryFee: 700,
            platformExitFee: 600,
            managerExitFee: 1400,
            platformPerformanceFee: 10000,
            managerPerformanceFee: 90000,
            platformManagementFee: 2000,
            managerManagementFee: 8000
        };
        let tx = await htVault.setFeeConfig(feeConfig);
        await tx.wait();

        // deposit from users
        tx = await erc20.connect(user).approve(htVault.address, parseEther("300"));
        await tx.wait();

        tx = await htVault.connect(user).requestDeposit(parseEther("100"), user.address);
        await tx.wait();

        tx = await erc20.connect(user2).approve(htVault.address, parseEther("400"));
        await tx.wait();

        tx = await htVault.connect(user2).requestDeposit(parseEther("200"), user2.address);
        await tx.wait();

        // enter cycle #1
        let block = await ethers.provider.getBlock(tx.blockNumber || 0);
        tx = await htVault.connect(auditor).enterNextCycle(
            0,
            parseEther("0"),
            parseEther("10000"),
            parseEther("0"),
            block.timestamp,
            block.timestamp + 1000,
            false
        );
        await tx.wait();

        let shares = await htVault.connect(user).callStatic.claimOwedShares(user.address);
        tx = await htVault.connect(user).claimAndRequestWithdraw(shares, user.address);
        await tx.wait();

        shares = await htVault.connect(user2).callStatic.claimOwedShares(user2.address);
        tx = await htVault.connect(user2).claimAndRequestWithdraw(shares, user2.address);
        await tx.wait();

        // enter cycle #2
        let newFundValue = parseEther("250");
        block = await ethers.provider.getBlock(tx.blockNumber || 0);
        let withdrawAmount = await htVault.previewNextCycle(newFundValue, block.timestamp);
        tx = await htVault.connect(auditor).enterNextCycle(
            1,
            newFundValue,
            parseEther("10000"),
            withdrawAmount,
            block.timestamp,
            block.timestamp + 1000,
            false
        );
        await tx.wait();
        
        // enter cycle #3 with no shares (should fail)
        newFundValue = parseEther("0");
        block = await ethers.provider.getBlock(tx.blockNumber || 0);
        withdrawAmount = await htVault.previewNextCycle(newFundValue, block.timestamp);
        await expect(htVault.connect(auditor).enterNextCycle(
            2,
            newFundValue,
            parseEther("10000"),
            withdrawAmount,
            block.timestamp,
            block.timestamp + 1000,
            false
        )).to.be.revertedWithCustomError(htVault, "NoDeposits");

        // add some deposits
        tx = await htVault.connect(user).requestDeposit(parseEther("100"), user.address);
        await tx.wait();

        // enter cycle #3
        newFundValue = parseEther("0");
        block = await ethers.provider.getBlock(tx.blockNumber || 0);
        withdrawAmount = await htVault.previewNextCycle(newFundValue, block.timestamp);
        tx = await htVault.connect(auditor).enterNextCycle(
            2,
            newFundValue,
            parseEther("10000"),
            withdrawAmount,
            block.timestamp,
            block.timestamp + 1000,
            false
        );
        await tx.wait();
    });

    it("Test requestDeposit and cancelDeposit", async function () {
        let tx = await erc20.connect(user).approve(htVault.address, parseEther("10000"));
        await tx.wait();

        // test requestDeposits
        let balance = await erc20.balanceOf(user.address);
        tx = await htVault.connect(user).requestDeposit(parseEther("100"), user.address);
        await tx.wait();
        expect(balance.sub(await erc20.balanceOf(user.address))).to.equal(parseEther("100"));

        let results = await htVault.requestedFunds(user.address);
        expect(results.assets).to.equal(parseEther("100"));
        expect(results.shares).to.equal(0);

        balance = await erc20.balanceOf(user.address);
        tx = await htVault.connect(user).cancelDeposit(parseEther("50"), user.address);
        await tx.wait();
        expect((await erc20.balanceOf(user.address)).sub(balance)).to.equal(parseEther("50"));

        await expect(htVault.connect(user2).requestDeposit(parseEther("50"), user2.address)).to.be.revertedWith("ERC20: insufficient allowance");

        results = await htVault.requestedFunds(user.address);
        expect(results.assets).to.equal(parseEther("50"));
        expect(results.shares).to.equal(0);

        await expect(htVault.connect(user3).cancelDeposit(parseEther("10"), user3.address)).to.be.revertedWithCustomError(htVault, "NotEnoughDeposits");

        // enter next cycle
        const block = await ethers.provider.getBlock(tx.blockNumber || 0);
        tx = await htVault.connect(auditor).enterNextCycle(0, parseEther("0"), parseEther("200"), parseEther("0"), block.timestamp, block.timestamp + 1000, false);
        await tx.wait();

        // try to cancel deposits on previous cycle
        await expect(htVault.connect(user).cancelDeposit(parseEther("50"), user.address)).to.be.revertedWithCustomError(htVault, "NotEnoughDeposits");

        // requestedFunds should be zero
        results = await htVault.requestedFunds(user.address);
        expect(results.assets).to.equal(0);
        expect(results.shares).to.equal(0);

        // verify deposit
        let shares = await htVault.connect(user).callStatic.claimOwedShares(user.address);
        expect(shares).to.equal(parseEther("0.4995"));

        balance = await htVault.balanceOf(user.address);
        tx = await htVault.connect(user).claimOwedShares(user.address);
        await tx.wait();
        expect((await htVault.balanceOf(user.address)).sub(balance)).to.equal(parseEther("0.4995"));
    });

    it("Test requestWithdraw and cancelWithdraw", async function () {
        let tx = await erc20.connect(user).approve(htVault.address, parseEther("10000"));
        await tx.wait();

        tx = await erc20.connect(user2).approve(htVault.address, parseEther("10000"));
        await tx.wait();

        // deposit some assets
        tx = await htVault.connect(user).requestDeposit(parseEther("100"), user.address);
        await tx.wait();

        tx = await htVault.connect(user2).requestDeposit(parseEther("200"), user2.address);
        await tx.wait();

        // enter next cycle
        let block = await ethers.provider.getBlock(tx.blockNumber || 0);
        tx = await htVault.connect(auditor).enterNextCycle(0, parseEther("0"), parseEther("200"), parseEther("0"), block.timestamp, block.timestamp + 1000, false);
        await tx.wait();

        // requestedFunds should be zero
        let results = await htVault.requestedFunds(user.address);
        expect(results.assets).to.equal(0);
        expect(results.shares).to.equal(0);

        // claim
        tx = await htVault.connect(user).claimOwedShares(user.address);
        await tx.wait();

        tx = await htVault.connect(user2).claimOwedShares(user2.address);
        await tx.wait();

        // test request withdraw
        let balance = await htVault.balanceOf(user.address);
        tx = await htVault.connect(user).requestWithdraw(parseEther("0.999"), user.address);
        await tx.wait();
        expect(balance.sub(await htVault.balanceOf(user.address))).to.equal(parseEther("0.999"));

        // test cancel withdraw
        balance = await htVault.balanceOf(user.address);
        tx = await htVault.connect(user).cancelWithdraw(parseEther("0.999"), user.address);
        await tx.wait();
        expect((await htVault.balanceOf(user.address)).sub(balance)).to.equal(parseEther("0.999"));

        // test request withdraw for approved user
        tx = await htVault.connect(user2).approve(user3.address, parseEther("1"));
        await tx.wait();

        tx = await htVault.connect(user3).requestWithdraw(parseEther("1"), user2.address);
        await tx.wait();

        await expect(htVault.connect(user3).requestWithdraw(parseEther("0.5"), user2.address)).to.be.revertedWith("ERC20: insufficient allowance");

        // test cancel withdraw without requests
        await expect(htVault.connect(user3).cancelWithdraw(parseEther("1"), user3.address)).to.be.revertedWithCustomError(htVault, "NotEnoughWithdrawals");

        // test cancel withdraw to another address
        balance = await htVault.balanceOf(user3.address);
        tx = await htVault.connect(user2).cancelWithdraw(parseEther("1"), user3.address);
        await tx.wait();
        expect((await htVault.balanceOf(user3.address)).sub(balance)).to.equal(parseEther("1"));

        // enter next cycle
        block = await ethers.provider.getBlock(tx.blockNumber || 0);
        const withdrawAmount = await htVault.previewNextCycle(parseEther("300"), block.timestamp);
        tx = await htVault.connect(auditor).enterNextCycle(1, parseEther("300"), parseEther("200"), withdrawAmount, block.timestamp, block.timestamp + 1000, false);
        await tx.wait();

        // try to cancel withdraw of previous cycle
        await expect(htVault.connect(user2).cancelWithdraw(parseEther("1"), user.address)).to.be.revertedWithCustomError(htVault, "NotEnoughWithdrawals");
    });

    it("Test claimOwedAssets and claimOwedShares", async function () {
        let tx = await erc20.connect(user).approve(htVault.address, parseEther("10000"));
        await tx.wait();

        tx = await erc20.connect(user2).approve(htVault.address, parseEther("10000"));
        await tx.wait();

        // deposit
        tx = await htVault.connect(user).requestDeposit(parseEther("100"), user.address);
        await tx.wait();

        tx = await htVault.connect(user2).requestDeposit(parseEther("50"), user2.address);
        await tx.wait();

        // enter next cycle
        let block = await ethers.provider.getBlock(tx.blockNumber || 0);
        tx = await htVault.connect(auditor).enterNextCycle(0, parseEther("0"), parseEther("200"), parseEther("0"), block.timestamp, block.timestamp + 1000, false);
        await tx.wait();

        // test claimOwedShares
        let shares = await htVault.connect(user).callStatic.claimOwedShares(user.address);
        tx = await htVault.connect(user).claimOwedShares(user.address);
        await tx.wait();

        let balance = await htVault.balanceOf(user.address);
        expect(balance).to.equal(parseEther("0.999"));
        expect(balance).to.equal(shares);

        // claimOwedShares again, balance should not change
        tx = await htVault.connect(user).claimOwedShares(user.address);
        await tx.wait();

        balance = await htVault.balanceOf(user.address);
        expect(balance).to.equal(parseEther("0.999"));

        shares = await htVault.connect(user).callStatic.claimOwedShares(user.address);
        expect(shares).to.equal(0);

        // withdraw
        tx = await htVault.connect(user).requestWithdraw(parseEther("0.5"), user.address);
        await tx.wait();

        // enter next cycle
        block = await ethers.provider.getBlock(tx.blockNumber || 0);
        let withdrawAmount = await htVault.previewNextCycle(parseEther("150"), block.timestamp);
        tx = await htVault.connect(auditor).enterNextCycle(1, parseEther("150"), parseEther("200"), withdrawAmount, block.timestamp, block.timestamp + 1000, false);
        await tx.wait();

        // claimOwedAssets
        let assets = await htVault.connect(user).callStatic.claimOwedAssets(user.address);
        let currentBalance = await erc20.balanceOf(user.address);
        tx = await htVault.connect(user).claimOwedAssets(user.address);
        await tx.wait();
        balance = await erc20.balanceOf(user.address);
        expect(balance.sub(currentBalance)).to.equal(assets);

        // claimOwedAssets again, balance should not change
        tx = await htVault.connect(user).claimOwedAssets(user.address);
        await tx.wait();
        expect(await erc20.balanceOf(user.address)).to.equal(balance);

        assets = await htVault.connect(user).callStatic.claimOwedAssets(user.address);
        expect(assets).to.equal(0);
    });

    it("Test claimOwedFunds", async function () {
        let tx = await erc20.connect(user).approve(htVault.address, parseEther("10000"));
        await tx.wait();

        tx = await erc20.connect(user2).approve(htVault.address, parseEther("10000"));
        await tx.wait();

        // deposit
        tx = await htVault.connect(user).requestDeposit(parseEther("100"), user.address);
        await tx.wait();

        tx = await htVault.connect(user2).requestDeposit(parseEther("50"), user2.address);
        await tx.wait();

        // enter next cycle
        let block = await ethers.provider.getBlock(tx.blockNumber || 0);
        tx = await htVault.connect(auditor).enterNextCycle(0, parseEther("0"), parseEther("200"), parseEther("0"), block.timestamp, block.timestamp + 1000, false);
        await tx.wait();

        // withdraw
        tx = await htVault.connect(user).claimAndRequestWithdraw(parseEther("0.5"), user.address);
        await tx.wait();

        // deposit
        tx = await htVault.connect(user).requestDeposit(parseEther("100"), user.address);
        await tx.wait();

        // enter next cycle
        block = await ethers.provider.getBlock(tx.blockNumber || 0);
        let withdrawAmount = await htVault.previewNextCycle(parseEther("250"), block.timestamp);
        tx = await htVault.connect(auditor).enterNextCycle(1, parseEther("250"), parseEther("200"), withdrawAmount, block.timestamp, block.timestamp + 1000, false);
        await tx.wait();

        // claimOwedFunds
        let results = await htVault.connect(user).callStatic.claimOwedFunds(user.address);
        let balance = await erc20.balanceOf(user.address);
        let shareBalance = await htVault.balanceOf(user.address);
        tx = await htVault.connect(user).claimOwedFunds(user.address);
        await tx.wait();
        balance = (await erc20.balanceOf(user.address)).sub(balance);
        shareBalance = (await htVault.balanceOf(user.address)).sub(shareBalance);
        expect(balance).to.equal(results.assets);
        expect(shareBalance).to.equal(results.shares);
    });

    it("test closePosition", async function () {
        // set NFT
        let tx = await htVault.setEnabledNFTs([nftOG.address, nftVIP.address]);
        await tx.wait();

        tx = await erc20.connect(user).approve(htVault.address, parseEther("10000"));
        await tx.wait();

        tx = await erc20.connect(user2).approve(htVault.address, parseEther("10000"));
        await tx.wait();

        tx = await erc20.connect(user3).approve(htVault.address, parseEther("10000"));
        await tx.wait();

        // deposit some assets
        tx = await htVault.connect(user).requestDeposit(parseEther("100"), user.address);
        await tx.wait();

        tx = await htVault.connect(user2).requestDeposit(parseEther("200"), user2.address);
        await tx.wait();

        tx = await htVault.connect(user3).requestDeposit(parseEther("150"), user3.address);
        await tx.wait();

        // enter next cycle
        let block = await ethers.provider.getBlock(tx.blockNumber || 0);
        tx = await htVault.connect(auditor).enterNextCycle(0, parseEther("0"), parseEther("200"), parseEther("0"), block.timestamp, block.timestamp + 1000, false);
        await tx.wait();

        // test closePosition when fund is not closed
        tx = await htVault.connect(user2).claimOwedShares(user2.address);
        await tx.wait();

        let balance = await htVault.balanceOf(user2.address);
        await expect(htVault.connect(user2).closePosition(balance, user2.address)).to.be.revertedWithCustomError(htVault, "FundIsNotClosed");

        // deposit some more assets
        tx = await htVault.connect(user).requestDeposit(parseEther("100"), user.address);
        await tx.wait();

        // close fund
        block = await ethers.provider.getBlock(tx.blockNumber || 0);
        balance = await erc20.balanceOf(teaVault.address);
        tx = await htVault.connect(auditor).enterNextCycle(1, balance, parseEther("200"), balance, block.timestamp, block.timestamp + 1000, true);
        await tx.wait();

        // verify
        let globalState = await htVault.globalState()
        expect(globalState.fundClosed).to.equal(true);

        // test closePosition
        balance = await htVault.balanceOf(user2.address);
        let assets = await htVault.connect(user2).callStatic.closePosition(balance, user2.address);
        tx = await htVault.connect(user2).closePosition(balance, user2.address);
        await tx.wait();
        let owedAssets = await htVault.connect(user2).callStatic.claimOwedAssets(user2.address);
        expect(owedAssets).to.equal(assets);

        // try closePosition again
        await expect(htVault.connect(user2).closePosition(balance, user2.address)).to.be.revertedWith("ERC20: burn amount exceeds balance");

        // test closePosition for another address
        tx = await htVault.connect(user3).claimOwedShares(user3.address);
        await tx.wait();

        await expect(htVault.connect(user4).closePosition(balance, user3.address)).to.be.revertedWith("ERC20: insufficient allowance");

        balance = await htVault.balanceOf(user3.address);
        tx = await htVault.connect(user3).approve(user4.address, balance);
        await tx.wait();

        assets = await htVault.connect(user4).callStatic.closePosition(balance, user3.address);
        tx = await htVault.connect(user4).closePosition(balance, user3.address);
        await tx.wait();
        owedAssets = await htVault.connect(user3).callStatic.claimOwedAssets(user3.address);
        expect(owedAssets).to.equal(assets);

        // test closePositionAndClaim
        assets = await htVault.connect(user).callStatic.closePositionAndClaim(user.address);
        let beforeBalance = await erc20.balanceOf(user.address);
        tx = await htVault.connect(user).closePositionAndClaim(user.address);
        await tx.wait();
        let afterBalance = await erc20.balanceOf(user.address);
        expect(afterBalance.sub(beforeBalance)).to.equal(assets);
    });
});


describe("htVaultETH", function () {

    let admin: SignerWithAddress; // owner address
    let user: SignerWithAddress; // user address
    let user2: SignerWithAddress; // second user address
    let user3: SignerWithAddress; // third user address
    let user4: SignerWithAddress; // fourth user address (has nothing)
    let auditor: SignerWithAddress; // auditor address
    let platformVault: SignerWithAddress; // platform vault address
    let managerVault: SignerWithAddress; // manager vault address

    let htVault: HighTableVaultETH;
    let nftOG: MockERC721;
    let nftVIP: MockERC721;
    let weth: MockWETH9;
    let teaVault: MockTeaVaultV2;    

    beforeEach(async function () {
        [admin, user, user2, user3, user4, auditor, platformVault, managerVault] = await ethers.getSigners();

        // deploy
        const MockWETH9 = await ethers.getContractFactory("MockWETH9");
        weth = await MockWETH9.deploy();

        const NFT = await ethers.getContractFactory("MockERC721");
        nftOG = await NFT.deploy();
        nftVIP = await NFT.deploy();

        const block = await ethers.provider.getBlock('latest');
        const HTVaultETH = await ethers.getContractFactory("HighTableVaultETH");
        htVault = await HTVaultETH.deploy("Test Vault #2", "NFT2", weth.address, 100, 1, block.timestamp, admin.address);

        const AUDITOR_ROLE = await htVault.AUDITOR_ROLE();
        let tx = await htVault.grantRole(AUDITOR_ROLE, auditor.address);
        await tx.wait();

        const feeConfig = {
            platformVault: platformVault.address,
            managerVault: managerVault.address,
            platformEntryFee: 300,
            managerEntryFee: 700,
            platformExitFee: 600,
            managerExitFee: 1400,
            platformPerformanceFee: 10000,
            managerPerformanceFee: 90000,
            platformManagementFee: 2000,
            managerManagementFee: 8000
        };
        tx = await htVault.setFeeConfig(feeConfig);
        await tx.wait();

        const TeaVault = await ethers.getContractFactory("MockTeaVaultV2");
        teaVault = await TeaVault.deploy(htVault.address);

        tx = await htVault.setTeaVaultV2(teaVault.address);
        await tx.wait();

        tx = await htVault.setEnabledNFTs([nftOG.address]);
        await tx.wait();        

        const timestamp = Math.floor((new Date()).getTime() / 1000);
        tx = await htVault.connect(auditor).setFundLockingTimestamp(timestamp + 1000);
        await tx.wait();

        tx = await htVault.connect(auditor).setDepositLimit(parseEther("10000"));
        await tx.wait();

        // mint some nft
        tx = await nftOG.connect(user).mint(user.address);
        await tx.wait();
        tx = await nftOG.connect(user2).mint(user2.address);
        await tx.wait();
        tx = await nftVIP.connect(user3).mint(user3.address);
        await tx.wait();
    });

    it("Test receiving ETH", async function() {
        await expect(admin.sendTransaction({ to: htVault.address, value: parseEther("1") })).to.be.revertedWithCustomError(htVault, "NotAcceptingETH");
    });

    it("Test depositToVaultETH", async function () {
        // transfer some WETH tokens to HighTableVault
        let tx = await weth.deposit({ value: parseEther("1") });
        await tx.wait();

        tx = await weth.transfer(htVault.address, parseEther("1"));
        await tx.wait();

        // should fail from non-auditor
        await expect(htVault.connect(user).depositToVault(parseEther("1"))).to.be.revertedWithCustomError(htVault, "OnlyAvailableToAuditors");

        // deposit
        const beforeHTBalance = await weth.balanceOf(htVault.address);
        const beforeTVBalance = await ethers.provider.getBalance(teaVault.address);
        tx = await htVault.connect(auditor).depositToVaultETH(parseEther("1"));
        await tx.wait();
        const afterHTBalance = await weth.balanceOf(htVault.address);
        const afterTVBalance = await ethers.provider.getBalance(teaVault.address);

        // verify
        expect(beforeHTBalance.sub(afterHTBalance)).to.equal(parseEther("1"));
        expect(afterTVBalance.sub(beforeTVBalance)).to.equal(parseEther("1"));
    });

    it("Test withdrawFromVault", async function () {
        // deposit some tokens to TeaVault
        let tx = await teaVault.assignInvestor(admin.address);
        await tx.wait();

        tx = await teaVault.connect(admin).depositETH(parseEther("1"), { value: parseEther("1") });
        await tx.wait();

        tx = await teaVault.assignInvestor(htVault.address);
        await tx.wait();

        // should fail from non-auditor
        await expect(htVault.connect(user).withdrawFromVaultETH(parseEther("1"))).to.be.revertedWithCustomError(htVault, "OnlyAvailableToAuditors");

        // withdraw
        const beforeHTBalance = await weth.balanceOf(htVault.address);
        const beforeTVBalance = await ethers.provider.getBalance(teaVault.address);
        tx = await htVault.connect(auditor).withdrawFromVaultETH(parseEther("1"));
        await tx.wait();
        const afterHTBalance = await weth.balanceOf(htVault.address);
        const afterTVBalance = await ethers.provider.getBalance(teaVault.address);

        // verify
        expect(afterHTBalance.sub(beforeHTBalance)).to.equal(parseEther("1"));
        expect(beforeTVBalance.sub(afterTVBalance)).to.equal(parseEther("1"));
    });

    it("Test enterNextCycleETH", async function () {
        // set fee
        const feeConfig = {
            platformVault: platformVault.address,
            managerVault: managerVault.address,
            platformEntryFee: 300,
            managerEntryFee: 700,
            platformExitFee: 600,
            managerExitFee: 1400,
            platformPerformanceFee: 10000,
            managerPerformanceFee: 90000,
            platformManagementFee: 2000,
            managerManagementFee: 8000
        };
        let tx = await htVault.setFeeConfig(feeConfig);
        await tx.wait();

        // deposit from users
        tx = await htVault.connect(user).requestDepositETH(parseEther("1"), user.address, { value: parseEther("1") });
        await tx.wait();

        tx = await htVault.connect(user2).requestDepositETH(parseEther("2"), user2.address, { value: parseEther("2") });
        await tx.wait();

        // should fail from non-auditor
        let block = await ethers.provider.getBlock(tx.blockNumber || 0);
        await expect(htVault.connect(user).enterNextCycleETH(
            0, 
            parseEther("0"), 
            parseEther("100"),
            parseEther("0"),
            block.timestamp,
            block.timestamp + 1000,
            false
        )).to.be.revertedWithCustomError(htVault, "OnlyAvailableToAuditors");

        // enter cycle with timestamp before initialization
        await expect(htVault.connect(auditor).enterNextCycleETH(
            0, 
            parseEther("0"), 
            parseEther("100"),
            parseEther("0"),
            block.timestamp - 1000,
            block.timestamp + 1000,
            false
        )).to.be.revertedWithCustomError(htVault, "IncorrectCycleStartTimestamp");

        // enter cycle with timestamp later than block time
        await expect(htVault.connect(auditor).enterNextCycleETH(
            0, 
            parseEther("0"), 
            parseEther("100"),
            parseEther("0"),
            block.timestamp + 1000,
            block.timestamp + 2000,
            false
        )).to.be.revertedWithCustomError(htVault, "IncorrectCycleStartTimestamp");

        // enter cycle #1
        let platformBalance = await ethers.provider.getBalance(platformVault.address);
        let managerBalance = await ethers.provider.getBalance(managerVault.address);
        tx = await htVault.connect(auditor).enterNextCycleETH(
            0,
            parseEther("0"),
            parseEther("100"),
            parseEther("0"),
            block.timestamp,
            block.timestamp + 1000,
            false
        );
        await tx.wait();

        // try to enter cycle #1 again
        await expect(htVault.connect(auditor).enterNextCycleETH(
            0,
            parseEther("0"),
            parseEther("100"),
            parseEther("0"),
            block.timestamp,
            block.timestamp + 1000,
            false
        )).to.be.revertedWithCustomError(htVault, "IncorrectCycleIndex");

        // try to enter cycle #3
        await expect(htVault.connect(auditor).enterNextCycleETH(
            2,
            parseEther("0"),
            parseEther("100"),
            parseEther("0"),
            block.timestamp,
            block.timestamp + 1000,
            false
        )).to.be.revertedWithCustomError(htVault, "IncorrectCycleIndex");

        // verify platform vault balance and manager vault balance
        platformBalance = (await ethers.provider.getBalance(platformVault.address)).sub(platformBalance);
        managerBalance = (await ethers.provider.getBalance(managerVault.address)).sub(managerBalance);
        expect(platformBalance).to.equal(parseEther("0.0009"));
        expect(managerBalance).to.equal(parseEther("0.0021"));

        // verify globalState
        let globalState = await htVault.globalState();
        expect(globalState.cycleIndex).to.equal(1);
        expect(globalState.cycleStartTimestamp).to.equal(block.timestamp);
        expect(globalState.fundingLockTimestamp).to.equal(block.timestamp + 1000);

        // verify cycleState
        let cycleState = await htVault.cycleState(0);
        expect(cycleState.totalFundValue).to.equal(0);
        expect(cycleState.fundValueAfterRequests).to.equal(parseEther("2.997"));    // 0.1% entry fee
        expect(cycleState.requestedDeposits).to.equal(parseEther("3"));
        expect(cycleState.convertedDeposits).to.equal(parseEther("0.02997"));
        expect(cycleState.requestedWithdrawals).to.equal(0);
        expect(cycleState.convertedWithdrawals).to.equal(0);

        // claim
        let shares = await htVault.connect(user).callStatic.claimOwedShares(user.address);
        expect(shares).to.equal(parseEther("0.00999"));                               // 0.1% entry fee

        shares = await htVault.connect(user2).callStatic.claimOwedShares(user2.address);
        expect(shares).to.equal(parseEther("0.01998"));                               // 0.1% entry fee

        tx = await htVault.connect(user).claimOwedShares(user.address);
        await tx.wait();

        expect(await htVault.balanceOf(user.address)).to.equal(parseEther("0.00999"));        // 0.1% entry fee

        shares = await htVault.connect(user).callStatic.claimOwedShares(user.address);
        expect(shares).to.equal(0);

        // claim again, balance should not change
        tx = await htVault.connect(user).claimOwedShares(user.address);
        await tx.wait();
        expect(await htVault.balanceOf(user.address)).to.equal(parseEther("0.00999")); 

        // request withdraw
        tx = await htVault.connect(user).requestWithdraw(parseEther("0.0099"), user.address);
        await tx.wait();

        // request deposit again without withdrawal
        tx = await htVault.connect(user2).requestDepositETH(parseEther("1"), user2.address, { value: parseEther("1") });
        await tx.wait();

        // enter next cycle again
        // deposit some tokens to TeaVault
        tx = await teaVault.assignInvestor(admin.address);
        await tx.wait();

        tx = await teaVault.connect(admin).depositETH(parseEther("1"), { value: parseEther("1") });
        await tx.wait();

        tx = await teaVault.assignInvestor(htVault.address);
        await tx.wait();

        globalState = await htVault.globalState();
        let balance = await weth.balanceOf(htVault.address);
        expect(balance).to.equal(globalState.lockedAssets);

        let cycleStartTimestamp = globalState.cycleStartTimestamp;

        block = await ethers.provider.getBlock(tx.blockNumber || 0);
        let newFundValue = parseEther("4");
        let withdrawAmount = await htVault.previewNextCycle(newFundValue, block.timestamp);
        platformBalance = await ethers.provider.getBalance(platformVault.address);
        managerBalance = await ethers.provider.getBalance(managerVault.address);
        tx = await htVault.connect(auditor).enterNextCycleETH(
            1,
            newFundValue,
            parseEther("100"),
            withdrawAmount,
            block.timestamp,
            block.timestamp + 1000,
            false
        );
        await tx.wait();

        let timeDiff = block.timestamp - cycleStartTimestamp.toNumber();

        // calculate performance fees
        let profit = newFundValue.sub(parseEther("2.997"));
        let platformPerformanceFee = profit.div(100);             // 1% performance fee
        let managerPerformanceFee = profit.mul(9).div(100);       // 9% performance fee

        // calculate management fees
        let platformManagementFee = newFundValue.mul(2).mul(timeDiff).div(1000 * 365 * 86400);    // 0.2% yearly management fee
        let managerManagementFee = newFundValue.mul(8).mul(timeDiff).div(1000 * 365 * 86400);     // 0.8% yearly management fee

        // substrate performance fees and management fees from new fund value
        newFundValue = newFundValue.sub(platformPerformanceFee).sub(managerPerformanceFee).sub(platformManagementFee).sub(managerManagementFee);

        // calculate withdrawal fees
        let totalSupply = parseEther("0.02997");
        let convertedWithdrawals = parseEther("0.0099").mul(newFundValue).div(totalSupply);
        let platformExitFee = convertedWithdrawals.mul(6).div(10000);     // 0.06% exit fee
        let managerExitFee = convertedWithdrawals.mul(14).div(10000);     // 0.14% exit fee

        // calculate entry fees
        let newDeposits = parseEther("1");
        let platformEntryFee = newDeposits.mul(3).div(10000);     // 0.03% entry fee
        let managerEntryFee = newDeposits.mul(7).div(10000);      // 0.07% entry fee
        let convertedDeposits = newDeposits.sub(platformEntryFee).sub(managerEntryFee).mul(totalSupply).div(newFundValue);

        // verify owed assets are correct
        let assets = await htVault.connect(user).callStatic.claimOwedAssets(user.address);
        expect(assets).to.equal(convertedWithdrawals.sub(platformExitFee).sub(managerExitFee));

        // verify owed shares are correct
        shares = await htVault.connect(user2).callStatic.claimOwedShares(user2.address);
        expect(shares).to.equal(convertedDeposits.add(parseEther("0.01998")));

        // calculate and verify total fees received by platform and manager
        const totalPlatformFee = platformPerformanceFee.add(platformManagementFee).add(platformExitFee).add(platformEntryFee);
        const totalManagerFee = managerPerformanceFee.add(managerManagementFee).add(managerExitFee).add(managerEntryFee);
        platformBalance = (await ethers.provider.getBalance(platformVault.address)).sub(platformBalance);
        managerBalance = (await ethers.provider.getBalance(managerVault.address)).sub(managerBalance);
        expect(platformBalance).to.equal(totalPlatformFee);
        expect(managerBalance).to.equal(totalManagerFee);

        // verify total supply
        let newTotalSupply = parseEther("0.02997").add(convertedDeposits).sub(parseEther("0.0099"));
        expect(await htVault.totalSupply()).to.equal(newTotalSupply);

        // request withdraw again without withdrawl
        tx = await htVault.connect(user).requestWithdraw(parseEther("0.00009"), user.address);
        await tx.wait();

        // test entering next cycle again
        block = await ethers.provider.getBlock(tx.blockNumber || 0);
        globalState = await htVault.globalState();
        cycleStartTimestamp = globalState.cycleStartTimestamp
        timeDiff = block.timestamp - cycleStartTimestamp.toNumber();
        newFundValue = parseEther("3");
        withdrawAmount = await htVault.previewNextCycle(newFundValue, block.timestamp);
        let results = await htVault.connect(auditor).callStatic.enterNextCycleETH(
            2,
            newFundValue,
            parseEther("100"),
            withdrawAmount,
            block.timestamp,
            block.timestamp + 1000,
            false
        );

        // no performance fee, calculate management fee
        platformManagementFee = newFundValue.mul(2).mul(timeDiff).div(1000 * 365 * 86400);    // 0.2% yearly management fee
        managerManagementFee = newFundValue.mul(8).mul(timeDiff).div(1000 * 365 * 86400);     // 0.8% yearly management fee

        // substrate management fees from new fund value
        newFundValue = newFundValue.sub(platformManagementFee).sub(managerManagementFee);

        // no entry fee, calculate exit fee
        convertedWithdrawals = parseEther("0.00009").mul(newFundValue).div(newTotalSupply);
        platformExitFee = convertedWithdrawals.mul(6).div(10000);     // 0.06% exit fee
        managerExitFee = convertedWithdrawals.mul(14).div(10000);     // 0.14% exit fee

        // verify fees
        expect(results.platformFee).to.equal(platformManagementFee.add(platformExitFee));
        expect(results.managerFee).to.equal(managerManagementFee.add(managerExitFee));

        // actually enter next cycle
        tx = await htVault.connect(auditor).enterNextCycleETH(
            2,
            parseEther("3"),
            parseEther("100"),
            withdrawAmount,
            block.timestamp,
            block.timestamp + 1000,
            false
        );
        await tx.wait();

        // claim
        let newAssets = await htVault.connect(user).callStatic.claimOwedAssets(user.address);
        expect(newAssets).to.equal(convertedWithdrawals.sub(platformExitFee).sub(managerExitFee).add(assets));

        // deposit and withdraw before closing
        balance = await ethers.provider.getBalance(user.address);
        tx = await htVault.connect(user).claimAndRequestDepositETH(parseEther("1"), user.address, { value: parseEther("1") });
        await tx.wait();
        balance = (await ethers.provider.getBalance(user.address)).sub(balance);
        expect(balance).to.equal(newAssets.sub(parseEther("1")).sub(await getGas(tx.hash)));

        // verify there's no assets other than the new deposit remaining in the vault
        balance = await weth.balanceOf(htVault.address);
        globalState = await htVault.globalState();
        expect(balance).to.equal(parseEther("1"));
        expect(globalState.lockedAssets).to.equal(balance);        

        tx = await htVault.connect(user2).claimAndRequestWithdraw(parseEther("0.01"), user2.address);
        await tx.wait();

        // close fund
        block = await ethers.provider.getBlock(tx.blockNumber || 0);
        globalState = await htVault.globalState();
        cycleStartTimestamp = globalState.cycleStartTimestamp
        timeDiff = block.timestamp - cycleStartTimestamp.toNumber();
        balance = await ethers.provider.getBalance(teaVault.address);
        results = await htVault.connect(auditor).callStatic.enterNextCycleETH(
            3,
            balance,
            parseEther("0"),
            balance,
            block.timestamp,
            block.timestamp + 1000,
            true
        );

        platformBalance = await ethers.provider.getBalance(platformVault.address);
        managerBalance = await ethers.provider.getBalance(managerVault.address);
        totalSupply = await htVault.totalSupply();
        tx = await htVault.connect(auditor).enterNextCycleETH(
            3,
            balance,
            parseEther("0"),
            balance,
            block.timestamp,
            block.timestamp + 1000,
            true
        );
        await tx.wait();

        globalState = await htVault.globalState();
        expect(await weth.balanceOf(htVault.address)).to.equal(globalState.lockedAssets);

        // calculate performance fee
        cycleState = await htVault.cycleState(2);
        profit = balance.sub(cycleState.fundValueAfterRequests);
        platformPerformanceFee = profit.div(100);             // 1% performance fee
        managerPerformanceFee = profit.mul(9).div(100);       // 9% performance fee        

        // calculate management fee
        platformManagementFee = balance.mul(2).mul(timeDiff).div(1000 * 365 * 86400);    // 0.2% yearly management fee
        managerManagementFee = balance.mul(8).mul(timeDiff).div(1000 * 365 * 86400);     // 0.8% yearly management fee

        // calculate entry fee
        newDeposits = parseEther("1");
        platformEntryFee = newDeposits.mul(3).div(10000);     // 0.03% entry fee
        managerEntryFee = newDeposits.mul(7).div(10000);      // 0.07% entry fee

        // calculate exit fee
        // has to calculate requested withdrawal separately to avoid rounding errors
        newFundValue = balance.sub(platformManagementFee).sub(managerManagementFee).sub(platformPerformanceFee).sub(managerPerformanceFee);
        convertedWithdrawals = parseEther("0.01").mul(newFundValue).div(totalSupply);
        platformExitFee = convertedWithdrawals.mul(6).div(10000);     // 0.06% exit fee
        managerExitFee = convertedWithdrawals.mul(14).div(10000);     // 0.14% exit fee
        let remainingWithdrawals = newFundValue.add(newDeposits).sub(platformEntryFee).sub(managerEntryFee).sub(convertedWithdrawals);
        platformExitFee = platformExitFee.add(remainingWithdrawals.mul(6).div(10000));     // 0.06% exit fee
        managerExitFee = managerExitFee.add(remainingWithdrawals.mul(14).div(10000));      // 0.14% exit fee

        // requests should fail after fund closed
        await expect(htVault.connect(user).requestDepositETH(parseEther("1"), user.address, { value: parseEther("1") })).to.be.revertedWithCustomError(htVault, "FundIsClosed");
        await expect(htVault.connect(user2).requestWithdraw(parseEther("0.001"), user2.address)).to.be.revertedWithCustomError(htVault, "FundIsClosed");

        // close position
        balance = await ethers.provider.getBalance(user.address);
        tx = await htVault.connect(user).closePositionAndClaimETH(user.address);
        await tx.wait();
        balance = (await ethers.provider.getBalance(user.address)).sub(balance).add(await getGas(tx.hash));

        let balance2 = await ethers.provider.getBalance(user2.address);
        tx = await htVault.connect(user2).closePositionAndClaimETH(user2.address);
        await tx.wait();
        balance2 = (await ethers.provider.getBalance(user2.address)).sub(balance2).add(await getGas(tx.hash));

        let totalWithdrawn = convertedWithdrawals.add(remainingWithdrawals).sub(platformExitFee).sub(managerExitFee);
        expect(balance.add(balance2).sub(totalWithdrawn).abs().toNumber()).to.lessThanOrEqual(1);

        // verify fees received by platformVault and managerVault
        platformBalance = (await ethers.provider.getBalance(platformVault.address)).sub(platformBalance);
        managerBalance = (await ethers.provider.getBalance(managerVault.address)).sub(managerBalance);
        expect(platformPerformanceFee.add(platformManagementFee).add(platformEntryFee).add(platformExitFee)).to.equal(platformBalance);
        expect(managerPerformanceFee.add(managerManagementFee).add(managerEntryFee).add(managerExitFee)).to.equal(managerBalance);
    });

    it("Test requestDepositETH and cancelDepositETH", async function () {
        // test requestDepositsETH
        let balance = await ethers.provider.getBalance(user.address);
        let tx = await htVault.connect(user).requestDepositETH(parseEther("1"), user.address, { value: parseEther("1") });
        await tx.wait();
        balance = balance.sub(await ethers.provider.getBalance(user.address)).sub(await getGas(tx.hash));
        expect(balance).to.equal(parseEther("1"));

        let results = await htVault.requestedFunds(user.address);
        expect(results.assets).to.equal(parseEther("1"));
        expect(results.shares).to.equal(0);

        balance = await ethers.provider.getBalance(user.address);
        tx = await htVault.connect(user).cancelDepositETH(parseEther("0.5"), user.address);
        await tx.wait();
        balance = (await ethers.provider.getBalance(user.address)).sub(balance).add(await getGas(tx.hash));
        expect(balance).to.equal(parseEther("0.5"));

        await expect(htVault.connect(user2).requestDepositETH(parseEther("0.5"), user2.address, { value: parseEther("0.4") })).to.be.revertedWithCustomError(htVault, "IncorrectETHAmount");

        results = await htVault.requestedFunds(user.address);
        expect(results.assets).to.equal(parseEther("0.5"));
        expect(results.shares).to.equal(0);

        await expect(htVault.connect(user3).cancelDepositETH(parseEther("0.1"), user3.address)).to.be.revertedWithCustomError(htVault, "NotEnoughDeposits");

        // enter next cycle
        const block = await ethers.provider.getBlock(tx.blockNumber || 0);
        tx = await htVault.connect(auditor).enterNextCycleETH(0, parseEther("0"), parseEther("200"), parseEther("0"), block.timestamp, block.timestamp + 1000, false);
        await tx.wait();

        // try to cancel deposits on previous cycle
        await expect(htVault.connect(user).cancelDepositETH(parseEther("0.5"), user.address)).to.be.revertedWithCustomError(htVault, "NotEnoughDeposits");

        // verify deposit
        let shares = await htVault.connect(user).callStatic.claimOwedShares(user.address);
        expect(shares).to.equal(parseEther("0.004995"));

        balance = await htVault.balanceOf(user.address);
        tx = await htVault.connect(user).claimOwedShares(user.address);
        await tx.wait();
        expect((await htVault.balanceOf(user.address)).sub(balance)).to.equal(parseEther("0.004995"));
    });

    it("Test claimOwedAssetsETH", async function () {
        // deposit
        let tx = await htVault.connect(user).requestDepositETH(parseEther("1"), user.address, { value: parseEther("1") });
        await tx.wait();

        tx = await htVault.connect(user2).requestDepositETH(parseEther("0.5"), user2.address, { value: parseEther("0.5") });
        await tx.wait();

        // enter next cycle
        let block = await ethers.provider.getBlock(tx.blockNumber || 0);
        tx = await htVault.connect(auditor).enterNextCycleETH(0, parseEther("0"), parseEther("200"), parseEther("0"), block.timestamp, block.timestamp + 1000, false);
        await tx.wait();

        // withdraw
        tx = await htVault.connect(user).claimAndRequestWithdraw(parseEther("0.005"), user.address);
        await tx.wait();

        // enter next cycle
        block = await ethers.provider.getBlock(tx.blockNumber || 0);
        let withdrawAmount = await htVault.previewNextCycle(parseEther("1.5"), block.timestamp);
        tx = await htVault.connect(auditor).enterNextCycleETH(1, parseEther("1.5"), parseEther("200"), withdrawAmount, block.timestamp, block.timestamp + 1000, false);
        await tx.wait();

        // claimOwedAssets
        let assets = await htVault.connect(user).callStatic.claimOwedAssetsETH(user.address);
        let balance = await ethers.provider.getBalance(user.address);
        tx = await htVault.connect(user).claimOwedAssetsETH(user.address);
        await tx.wait();
        balance = (await ethers.provider.getBalance(user.address)).sub(balance).add(await getGas(tx.hash));
        expect(balance).to.equal(assets);

        // claimOwedAssets again, balance should not change
        balance = await ethers.provider.getBalance(user.address);
        tx = await htVault.connect(user).claimOwedAssetsETH(user.address);
        await tx.wait();
        balance = (await ethers.provider.getBalance(user.address)).sub(balance).add(await getGas(tx.hash));
        expect(balance).to.equal(0);

        assets = await htVault.connect(user).callStatic.claimOwedAssetsETH(user.address);
        expect(assets).to.equal(0);
    });

    it("Test claimOwedFundsETH", async function () {
        // deposit
        let tx = await htVault.connect(user).requestDepositETH(parseEther("1"), user.address, { value: parseEther("1") });
        await tx.wait();

        tx = await htVault.connect(user2).requestDepositETH(parseEther("0.5"), user2.address, { value: parseEther("0.5") });
        await tx.wait();

        // enter next cycle
        let block = await ethers.provider.getBlock(tx.blockNumber || 0);
        tx = await htVault.connect(auditor).enterNextCycle(0, parseEther("0"), parseEther("200"), parseEther("0"), block.timestamp, block.timestamp + 1000, false);
        await tx.wait();

        // withdraw
        tx = await htVault.connect(user).claimAndRequestWithdraw(parseEther("0.005"), user.address);
        await tx.wait();

        // deposit
        tx = await htVault.connect(user).requestDepositETH(parseEther("1"), user.address, { value: parseEther("1") });
        await tx.wait();

        // enter next cycle
        block = await ethers.provider.getBlock(tx.blockNumber || 0);
        let withdrawAmount = await htVault.previewNextCycle(parseEther("2.5"), block.timestamp);
        tx = await htVault.connect(auditor).enterNextCycle(1, parseEther("2.5"), parseEther("200"), withdrawAmount, block.timestamp, block.timestamp + 1000, false);
        await tx.wait();

        // claimOwedFundsETH
        let results = await htVault.connect(user).callStatic.claimOwedFundsETH(user.address);
        let balance = await ethers.provider.getBalance(user.address);
        let shareBalance = await htVault.balanceOf(user.address);
        tx = await htVault.connect(user).claimOwedFundsETH(user.address);
        await tx.wait();
        balance = (await ethers.provider.getBalance(user.address)).sub(balance).add(await getGas(tx.hash));
        shareBalance = (await htVault.balanceOf(user.address)).sub(shareBalance);
        expect(balance).to.equal(results.assets);
        expect(shareBalance).to.equal(results.shares);
    });

    it("test closePosition", async function () {
        // deposit some assets
        let tx = await htVault.connect(user).requestDepositETH(parseEther("1"), user.address, { value: parseEther("1") });
        await tx.wait();

        tx = await htVault.connect(user2).requestDepositETH(parseEther("2"), user2.address, { value: parseEther("2") });
        await tx.wait();

        // enter next cycle
        let block = await ethers.provider.getBlock(tx.blockNumber || 0);
        tx = await htVault.connect(auditor).enterNextCycleETH(0, parseEther("0"), parseEther("200"), parseEther("0"), block.timestamp, block.timestamp + 1000, false);
        await tx.wait();

        // test closePosition when fund is not closed
        tx = await htVault.connect(user2).claimOwedShares(user2.address);
        await tx.wait();

        let balance = await htVault.balanceOf(user2.address);
        await expect(htVault.connect(user2).closePosition(balance, user2.address)).to.be.revertedWithCustomError(htVault, "FundIsNotClosed");

        // deposit some more assets
        tx = await htVault.connect(user).requestDepositETH(parseEther("1"), user.address, { value: parseEther("1") });
        await tx.wait();

        // close fund
        block = await ethers.provider.getBlock(tx.blockNumber || 0);
        balance = await ethers.provider.getBalance(teaVault.address);
        tx = await htVault.connect(auditor).enterNextCycleETH(1, balance, parseEther("200"), balance, block.timestamp, block.timestamp + 1000, true);
        await tx.wait();

        // verify
        let globalState = await htVault.globalState()
        expect(globalState.fundClosed).to.equal(true);

        // test closePosition
        balance = await htVault.balanceOf(user2.address);
        let assets = await htVault.connect(user2).callStatic.closePosition(balance, user2.address);
        tx = await htVault.connect(user2).closePosition(balance, user2.address);
        await tx.wait();
        let owedAssets = await htVault.connect(user2).callStatic.claimOwedAssetsETH(user2.address);
        expect(owedAssets).to.equal(assets);

        // try closePosition again
        await expect(htVault.connect(user2).closePosition(balance, user2.address)).to.be.revertedWith("ERC20: burn amount exceeds balance");

        // test closePositionAndClaim
        assets = await htVault.connect(user).callStatic.closePositionAndClaimETH(user.address);
        let beforeBalance = await ethers.provider.getBalance(user.address);
        tx = await htVault.connect(user).closePositionAndClaimETH(user.address);
        await tx.wait();
        let afterBalance = await ethers.provider.getBalance(user.address);
        expect(afterBalance.sub(beforeBalance).add(await getGas(tx.hash))).to.equal(assets);        
    });
});
