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

    const VAULT_NAME = process.env.VAULT_NAME || "";
    const VAULT_SYMBOL = process.env.VAULT_SYMBOL || "";
    const VAULT_ASSET = process.env.VAULT_ASSET || "";
    const VAULT_INITIAL_PRICE = process.env.VAULT_INITIAL_PRICE || "";
    const VAULT_PRICE_DENOMINATOR = process.env.VAULT_PRICE_DENOMINATOR || "";
    const VAULT_START_TIMESTAMP = process.env.VAULT_START_TIMESTAMP || "";
    const VAULT_INITIAL_ADMIN = process.env.VAULT_INITIAL_ADMIN || "";    

    // We get the contract to deploy
    const HighTableVault = await ethers.getContractFactory("HighTableVault");
    const hightableVault = await HighTableVault.deploy(
        VAULT_NAME,
        VAULT_SYMBOL,
        VAULT_ASSET,
        VAULT_INITIAL_PRICE,
        VAULT_PRICE_DENOMINATOR,
        VAULT_START_TIMESTAMP,
        VAULT_INITIAL_ADMIN
    );

    await hightableVault.deployed();

    console.log("HighTableVault deployed to:", hightableVault.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
