// Get historical data
// This can be used on a web site
// Teahouse Finance

import { ethers } from 'ethers';
import { MulticallBuilder } from './multicall';

export type HistoryDataItem = {
    cycle: number,
    startTimestamp: number
    tvl: number,
    profit: number,
    sharePrice: number,
};

const vaultAbi = [
    "function asset() public view returns (address)",
    "function globalState() public view returns (uint128 depositLimit, uint128 lockedAssets, uint32 cycleIndex, uint64 cycleStartTimestamp, uint64 fundingLockTimestamp, bool fundClosed)",
    "function cycleState(uint32) public view returns (uint128 totalFundValue, uint128 fundValueAfterRequests, uint128 requestedDeposits, uint128 convertedDeposits, uint128 requestedWithdrawals, uint128 convertedWithdrawals)",
    "event EnterNextCycle(address indexed caller, uint32 indexed cycleIndex, uint256 fundValue, uint256 priceNumerator, uint256 priceDenominator, uint256 depositLimit, uint64 startTimestamp, uint64 lockTimestamp, bool fundClosed, uint256 platformFee, uint256 managerFee)",
];

const erc20Abi = [
    "function decimals() public view returns (uint8)",
];

// vaultAddr: address of HighTableVault contract
// startCycle: starting cycle to get history data, use negative number for latest - n, e.g. -6 means most recent 6 cycles
// endCycle: ending cycle to get history data, use negative number for latest - n
// rpcProvider: ethereum provider
export async function getHistory(vaultAddr: string, startCycle: number, endCycle: number, rpcProvider: ethers.providers.Provider): Promise<HistoryDataItem[]> {
    const multicall = new MulticallBuilder(rpcProvider);
    const vault = new ethers.Contract(vaultAddr, vaultAbi, rpcProvider);

    let queue = multicall.newQueue();
    const assetIndex = queue.queue(vault, 'asset');
    const globalStateIndex = queue.queue(vault, 'globalState');
    const states = await queue.execute();

    const assetAddr = states[assetIndex][0];
    const globalState = states[globalStateIndex];

    const asset = new ethers.Contract(assetAddr, erc20Abi, rpcProvider);
    const assetDecimals = await asset.decimals();

    let results: HistoryDataItem[] = [];

    // check startCycle and endCycle
    const cycleIndex = globalState.cycleIndex;

    //console.log(cycleIndex);
    let start = startCycle;
    let end = endCycle;
    if (startCycle < 0) {
        start = cycleIndex + startCycle;
        if (start < 0) {
            start = 0;
        }
    }

    if (endCycle < 0) {
        end = cycleIndex + endCycle;
    }

    if (start < 0 || end < 0 || start > end || end >= cycleIndex) {
        throw new Error("Invalid startCycle or endCycle");
    }

    // get all required events at once
    let cycles = [];
    for (let i = start; i <= end; i++) {
        cycles.push(i);
    }

    const events = (await vault.queryFilter(vault.filters.EnterNextCycle(null, cycles)));
    //console.log(events);

    queue = multicall.newQueue();
    // get all required states at once
    for (let i = start; i <= end; i++) {
        queue.queue(vault, 'cycleState', i);
    }

    const cycleStates = await queue.execute();

    let lastState;

    for (let i = start; i <= end; i++) {
        const state = cycleStates[i - start];
        // find event
        const event = events.find(item => (item.args!.cycleIndex == i))!.args!;

        const tvl = state.fundValueAfterRequests.mul(1000000).div('1' + '0'.repeat(assetDecimals)).toNumber() / 1000000;

        let profit = 0;
        if (lastState !== undefined) {
            profit = state.totalFundValue.sub(lastState.fundValueAfterRequests).mul(1000000).div(lastState.fundValueAfterRequests).toNumber() / 1000000;
        }

        const sharePrice = event.priceNumerator.mul('1' + '0'.repeat(18)).mul(1000000).div(event.priceDenominator).div('1' + '0'.repeat(assetDecimals)).toNumber() / 1000000;        

        let item: HistoryDataItem = {
            cycle: i,
            startTimestamp: event.startTimestamp.toNumber(),
            tvl: tvl,
            profit: profit,
            sharePrice: sharePrice,
        };

        results.push(item);

        lastState = state;
    }

    return results;
}
