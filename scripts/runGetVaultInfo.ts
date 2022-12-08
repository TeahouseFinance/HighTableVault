// Runner for getVaultInfo.ts
// Teahouse Finance

import { ethers } from 'ethers';
import { getVaultInfo } from './getVaultInfo';

async function main() {
    const infuraID = '';        // set to your infura api key
    const ethRPC = 'https://mainnet.infura.io/v3/' + infuraID;
    const rpc = new ethers.providers.JsonRpcProvider(ethRPC);
    const vaultAddrs = [
        '0xb95573A6a139C96555c679140Bb1da5EfD91F3da',
        '0x9ed9c1C0F1c68666668A7aeDec5feC95abc7F943',
        '0xE1B3c128c0d0a9e41aB3fF8f0984e5d5bEf81677',
    ];

    // getting data from the last 6 cycles
    const startTime = (new Date()).getTime();
    const results = await getVaultInfo(vaultAddrs, rpc);
    for (let i = 0; i < results.length; i++) {
        console.log(results[i]);
    }
    console.log("time used: " + ((new Date()).getTime() - startTime) + " ms");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
