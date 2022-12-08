// Runner for getHistory.ts
// Teahouse Finance

import { ethers } from 'ethers';
import { getHistory } from './getHistory';

async function main() {
    const vaultAddr = '0xb95573A6a139C96555c679140Bb1da5EfD91F3da';
    const infuraID = '';        // set to your infura api key
    const ethRPC = 'https://mainnet.infura.io/v3/' + infuraID;
    const rpc = new ethers.providers.JsonRpcProvider(ethRPC);

    // getting data from the last 6 cycles
    const startTime = (new Date()).getTime();
    const results = await getHistory(vaultAddr, -8, -1, rpc);
    console.log(results);
    console.log("time used: " + ((new Date()).getTime() - startTime) + " ms");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
