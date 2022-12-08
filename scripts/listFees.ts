// List all fees to platform and manager in a table
// Teahouse Finance

// Run with hardhat
// npx hardhat run scripts/listFees.ts --network <network>

import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { HighTableVault } from '../typechain';
import * as https from 'https';


type CycleState = {
    index: number,
    endTimestamp: number,
    priceNumerator: string,
    priceDenominator: string,
    deposits: string,
    convertedDeposits: string,
    withdrawals: string,
    convertedWithdrawals: string,
    fundValue: string,
    fundValueAfterRequests: string,
    platformEntryFee: string,
    managerEntryFee: string,
    platformExitFee: string,
    managerExitFee: string,
    platformManagementFee: string,
    managerManagementFee: string,
    platformPerformanceFee: string,
    managerPerformanceFee: string,
    platformHWMFee: string,
    managerHWMFee: string,
};

type UserState = {
    address: string,
    shares: BigNumber,
    investedAssets: BigNumber,
    maxProfit: BigNumber,
};

const KEYS = [
    'index',
    'endTimestamp',
    'priceNumerator',
    'priceDenominator',
    'deposits',
    'convertedDeposits',
    'withdrawals',
    'convertedWithdrawals',
    'fundValue',
    'fundValueAfterRequests',
    'platformEntryFee',
    'managerEntryFee',
    'platformExitFee',
    'managerExitFee',
    'platformManagementFee',
    'managerManagementFee',
    'platformPerformanceFee',
    'managerPerformanceFee',
    'platformHWMFee',
    'managerHWMFee',
];


async function listFees(vault: HighTableVault): Promise<CycleState[]> {
    let results: CycleState[] = [];
    let users = new Map<string, UserState>;

    // retrieve global states
    const globalState = await vault.globalState();
    const cycleIndex = globalState.cycleIndex;
    const secondsInaYear = (await vault.SECONDS_IN_A_YEAR()).toNumber();

    // retrieve fee configs
    const fees = await vault.queryFilter(vault.filters.FeeConfigChanged());
    let feeIndex = 0;
    let fee = fees[0].args.feeConfig;
    feeIndex++;

    let lastTimestamp = 0;
    let previousFundValueAfterRequests = ethers.BigNumber.from(0);

    const fundInitial = await vault.queryFilter(vault.filters.FundInitialized());
    // let hwmPriceNumerator = fundInitial[0].args.priceNumerator;
    // let hwmPriceDenominator = fundInitial[0].args.priceDenominator;

    let previousCycleBlockNumber = 0;

    for(let i = 0; i < cycleIndex; i++) {
        const cycleState = await vault.cycleState(i);

        if (feeIndex < fees.length && fees[feeIndex].args.cycleIndex == i) {
            // fee changed
            fee = fees[feeIndex].args.feeConfig;
            feeIndex++;
        }

        // get cycle event
        const cycleEvent = await vault.queryFilter(vault.filters.EnterNextCycle(undefined, i));
        const cycle = cycleEvent[0].args;

        // calculate fees
        let timestamp = cycle.startTimestamp.toNumber();
        let profit = cycle.fundValue.sub(previousFundValueAfterRequests);
        if (profit.isNegative()) {
            profit = ethers.BigNumber.from(0);
        }

        // console.log("profit:", profit);

        const platformEntryFee = cycleState.requestedDeposits.mul(fee.platformEntryFee).div(1000000);
        const managerEntryFee = cycleState.requestedDeposits.mul(fee.managerEntryFee).div(1000000);
        const platformManagementFee = cycle.fundValue.mul(fee.platformManagementFee).mul(timestamp - lastTimestamp).div(secondsInaYear * 1000000);
        const managerManagementFee = cycle.fundValue.mul(fee.managerManagementFee).mul(timestamp - lastTimestamp).div(secondsInaYear * 1000000);
        const platformPerformanceFee = profit.mul(fee.platformPerformanceFee).div(1000000);
        const managerPerformanceFee = profit.mul(fee.managerPerformanceFee).div(1000000);

        const withdrawnAssets = cycleState.requestedWithdrawals.mul(cycle.priceNumerator).div(cycle.priceDenominator);
        const platformExitFee = withdrawnAssets.mul(fee.platformExitFee).div(1000000);
        const managerExitFee = withdrawnAssets.mul(fee.managerExitFee).div(1000000);

        // simulate high water mark performance fee
        // const totalSupply = cycle.priceDenominator;
        // let platformHWMFee = ethers.BigNumber.from(0);
        // let managerHWMFee = ethers.BigNumber.from(0);
        // if (cycle.fundValue.mul(hwmPriceDenominator).gt(hwmPriceNumerator.mul(totalSupply))) {
        //     // price is higher, calculate difference and multiply by totalSupply
        //     const hwmProfit = cycle.fundValue.sub(hwmPriceNumerator.mul(totalSupply).div(hwmPriceDenominator));
        //     platformHWMFee = hwmProfit.mul(fee.platformPerformanceFee).div(1000000);
        //     managerHWMFee = hwmProfit.mul(fee.managerPerformanceFee).div(1000000);

        //     // update new high water mark price
        //     hwmPriceNumerator = cycle.fundValue;
        //     hwmPriceDenominator = totalSupply;
        // }

        // ----------------------------------------------------------------------
        // calculate performance fee based on high water mark of individual users
        // ----------------------------------------------------------------------

        // let totalInvestedAssets = ethers.BigNumber.from(0);
        // let totalProfit = ethers.BigNumber.from(0);
        // let totalShares = ethers.BigNumber.from(0);
        // let totalValues = ethers.BigNumber.from(0);
        // console.log(cycleState);
        // console.log(cycle);

        // calculate fees for each user
        const totalSupply = cycle.priceDenominator;
        let platformHWMFee = ethers.BigNumber.from(0);
        let managerHWMFee = ethers.BigNumber.from(0);
        users.forEach(item => {
            const value = item.shares.mul(cycle.fundValue).div(totalSupply);
            const profit = value.sub(item.investedAssets);
            // totalProfit = totalProfit.add(profit);
            // totalInvestedAssets = totalInvestedAssets.add(item.investedAssets);
            // totalShares = totalShares.add(item.shares);
            // totalValues = totalValues.add(value);
            if (profit.gt(item.maxProfit)) {
                const profitDiff = profit.sub(item.maxProfit);
                item.maxProfit = profit;
                platformHWMFee = platformHWMFee.add(profitDiff.mul(fee.platformPerformanceFee).div(1000000));
                managerHWMFee = managerHWMFee.add(profitDiff.mul(fee.managerPerformanceFee).div(1000000));
            }
        });

        // remove PM fees from invested assets
        const totalPMFees = platformManagementFee.add(managerManagementFee).add(platformHWMFee).add(managerHWMFee);
        users.forEach(item => {
            const fee = item.shares.mul(totalPMFees).div(totalSupply);
            item.investedAssets = item.investedAssets.sub(fee);
        });

        // console.log("totalProfit:", totalProfit);
        // console.log("totalInvestedAssets:", totalInvestedAssets);
        // console.log("totalShares:", totalShares);
        // console.log("totalValues:", totalValues);
        // console.log(totalValues.sub(totalInvestedAssets));

        // update user states

        // get deposit events
        const requestedDeposits = await vault.queryFilter(vault.filters.DepositRequested(undefined, i));
        const cancelledDeposits = await vault.queryFilter(vault.filters.DepositCanceled(undefined, i));
        let deposits = new Map<string, BigNumber>;

        requestedDeposits.forEach(item => {
            let assets = deposits.get(item.args.receiver);
            if (assets == undefined) {
                assets = BigNumber.from(0);
            }

            assets = assets.add(item.args.assets);
            deposits.set(item.args.receiver, assets);
        });

        cancelledDeposits.forEach(item => {
            let assets = deposits.get(item.args.receiver);
            if (assets == undefined) {
                // shouldn't happen
                throw new Error("Invalid deposit cancelling");
            }

            assets = assets.sub(item.args.assets);
            deposits.set(item.args.receiver, assets);
        });

        // update user states with deposits
        deposits.forEach((value, key) => {
            let state = users.get(key);
            if (state == undefined) {
                // init user state if not initialized
                state = {
                    address: key,
                    shares: BigNumber.from(0),
                    investedAssets: BigNumber.from(0),
                    maxProfit: BigNumber.from(0),
                };
            }
    
            // update user state
            const entryFees = value.mul(fee.platformEntryFee + fee.managerEntryFee).div(1000000);
            const assets = value.sub(entryFees);

            // convertedDeposits and requestedDeposits already take fees in account, so no need to sub fees
            const newShares = value.mul(cycleState.convertedDeposits).div(cycleState.requestedDeposits);
            state.investedAssets = state.investedAssets.add(assets);
            state.shares = state.shares.add(newShares);
            users.set(key, state);
        });

        // get shares transfer events
        const transferEvents = await vault.queryFilter(vault.filters.Transfer(), previousCycleBlockNumber, cycleEvent[0].blockNumber - 1);

        // process share transfers
        transferEvents.forEach(item => {
            const from = item.args.from;
            const to = item.args.to;
            const value = item.args.value;

            if (from == '0x' + '0'.repeat(40)) {
                // mint event, ignore
                return;
            }

            if (from == vault.address) {
                // claim event, ignore
                return;
            }

            if (to == '0x' + '0'.repeat(40)) {
                // burn event, ignore
                return;
            }

            if (to == vault.address) {
                // withdrawal event, ignore
                return;
            }

            let fromState = users.get(from);
            if (fromState == undefined) {
                console.log(from);
                throw new Error("Invalid transfers");
            }

            let toState = users.get(to);
            if (toState == undefined) {
                // init user state if not initialized
                toState = {
                    address: to,
                    shares: BigNumber.from(0),
                    investedAssets: BigNumber.from(0),
                    maxProfit: BigNumber.from(0),
                };
            }

            // update states for 'from' address
            // remove investedAssets and maxProfits proportional to transfered shares
            const transferedAssets = value.mul(fromState.investedAssets).div(fromState.shares);
            fromState.investedAssets = fromState.investedAssets.sub(transferedAssets);
            const transferedProfits = value.mul(fromState.maxProfit).div(fromState.shares);
            fromState.maxProfit = fromState.maxProfit.sub(transferedProfits);
            fromState.shares = fromState.shares.sub(value);
            users.set(from, fromState);

            // update states for 'to' address
            toState.investedAssets = toState.investedAssets.add(transferedAssets);
            toState.maxProfit = toState.maxProfit.add(transferedProfits);
            toState.shares = toState.shares.add(value);
            users.set(to, toState);
        });        

        // get withdraw events
        const requestedWithdrawals = await vault.queryFilter(vault.filters.WithdrawalRequested(undefined, i));
        const cancelledWithdrawals = await vault.queryFilter(vault.filters.WithdrawalCanceled(undefined, i));
        let withdrawals = new Map<string, BigNumber>;

        requestedWithdrawals.forEach(item => {
            let shares = withdrawals.get(item.args.caller);
            if (shares == undefined) {
                shares = BigNumber.from(0);
            }

            shares = shares.add(item.args.shares);
            withdrawals.set(item.args.caller, shares);
        });

        cancelledWithdrawals.forEach(item => {
            let shares = withdrawals.get(item.args.caller);
            if (shares == undefined) {
                // shouldn't happen
                throw new Error("Invalid withdrawal cancelling");
            }

            shares = shares.sub(item.args.shares);
            withdrawals.set(item.args.caller, shares);
        });

        // update user states with withdrawals
        withdrawals.forEach((value, key) => {
            let state = users.get(key);
            if (state == undefined) {
                // shouldn't happen
                throw new Error("Invalid withdrawals");
            }
    
            // update user state
            // adjust investedAssets proportional to shares removed
            const removedAssets = value.mul(state.investedAssets).div(state.shares);
            state.investedAssets = state.investedAssets.sub(removedAssets);
            state.shares = state.shares.sub(value);
            users.set(key, state);
        });

        // update states
        lastTimestamp = timestamp;
        previousFundValueAfterRequests = cycleState.fundValueAfterRequests;
        previousCycleBlockNumber = cycleEvent[0].blockNumber;

        // push results
        results.push({
            index: i,
            endTimestamp: cycle.startTimestamp.toNumber(),
            priceNumerator: cycle.priceNumerator.toString(),
            priceDenominator: cycle.priceDenominator.toString(),
            deposits: cycleState.requestedDeposits.toString(),
            convertedDeposits: cycleState.convertedDeposits.toString(),
            withdrawals: cycleState.requestedWithdrawals.toString(),
            convertedWithdrawals: cycleState.convertedWithdrawals.toString(),
            fundValue: cycle.fundValue.toString(),
            fundValueAfterRequests: cycleState.fundValueAfterRequests.toString(),
            platformEntryFee: platformEntryFee.toString(),
            managerEntryFee: managerEntryFee.toString(),
            platformExitFee: platformExitFee.toString(),
            managerExitFee: managerExitFee.toString(),
            platformManagementFee: platformManagementFee.toString(),
            managerManagementFee: managerManagementFee.toString(),
            platformPerformanceFee: platformPerformanceFee.toString(),
            managerPerformanceFee: managerPerformanceFee.toString(),
            platformHWMFee: platformHWMFee.toString(),
            managerHWMFee: managerHWMFee.toString()
        });
    }

    console.log("Unique addresses: ",  users.size);

    //console.log(users);

    return results;
}

async function uploadSpreadsheet(data: string) {
    const SPREADSHEET_ID = encodeURI(process.env.SPREADSHEET_ID || "");
    const SPREADSHEET_TAB = encodeURI(process.env.SPREADSHEET_TAB || "");
    const SPREADSHEET_APIKEY = process.env.SPREADSHEET_APIKEY || "";

    const options = {
        host: 'gsheet-api.teahouse.finance',
        port: 443,
        path: '/write/' + SPREADSHEET_ID + '/' + SPREADSHEET_TAB,
        method: 'POST',       
        headers: {
            'Content-Type': 'application/json',
            "api-key": SPREADSHEET_APIKEY,
            'Content-Length': data.length,
        },
    }

    const req = https.request(options, res => {
        console.log("status code:", res.statusCode);

        req.on('data', d => {
            process.stdout.write(d);
        });
    });

    req.on('error', error => {
        console.log(error);
    });

    req.write(data);
    req.end();
}

async function main() {
    const VAULT_ADDRESS = process.env.VAULT_ADDRESS || "";

    if (VAULT_ADDRESS == "") {
        throw "No vault address";
    }

    if (!ethers.utils.isAddress(VAULT_ADDRESS)) {
        throw "Invalid vault address";
    }

    const HighTableVault = await ethers.getContractFactory("HighTableVault");
    const vault = HighTableVault.attach(VAULT_ADDRESS);

    const results = await listFees(vault);

    //console.log(JSON.stringify(results));
    // convert to arrays
    let arrayResults = [];
    arrayResults.push(KEYS);
    results.forEach(item => {
        const element = KEYS.map(key => (item as Record<string, number|string>)[key].toString());
        arrayResults.push(element);
    });
    const data = JSON.stringify(arrayResults);
    console.log(data);

    // upload
    uploadSpreadsheet(data);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
