// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from "hardhat";

async function main() {
    // Hardhat always runs the compile task when running scripts with its command
    // line interface.
    //
    // If this script is run directly using `node` you may want to call compile
    // manually to make sure everything is compiled
    // await hre.run('compile');

    const VAULTETH_NAME = process.env.VAULTETH_NAME || "";
    const VAULTETH_SYMBOL = process.env.VAULTETH_SYMBOL || "";
    const VAULTETH_WETH9 = process.env.VAULTETH_WETH9 || "";
    const VAULTETH_INITIAL_PRICE = process.env.VAULTETH_INITIAL_PRICE || "";
    const VAULTETH_PRICE_DENOMINATOR = process.env.VAULTETH_PRICE_DENOMINATOR || "";
    const VAULTETH_START_TIMESTAMP = process.env.VAULTETH_START_TIMESTAMP || "";
    const VAULTETH_INITIAL_ADMIN = process.env.VAULTETH_INITIAL_ADMIN || "";

    // We get the contract to deploy
    const HighTableVaultETH = await ethers.getContractFactory("HighTableVaultETH");
    const hightableVaultETH = await HighTableVaultETH.deploy(
        VAULTETH_NAME,
        VAULTETH_SYMBOL,
        VAULTETH_WETH9,
        VAULTETH_INITIAL_PRICE,
        VAULTETH_PRICE_DENOMINATOR,
        VAULTETH_START_TIMESTAMP,
        VAULTETH_INITIAL_ADMIN
    );

    await hightableVaultETH.deployed();

    console.log("HighTableVaultETH deployed to:", hightableVaultETH.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
