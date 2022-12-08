// Get current info from multiple vaults
// This can be used on a web site
// Teahouse Finance

import { ethers } from 'ethers';
import { MulticallBuilder } from './multicall';

export type AssetInfo = {
    address: string,
    name: string,
    symbol: string,
    decimals: number,
};

export type FeeConfig = {
    platformVault: string,
    managerVault: string,
    platformEntryFee: number,
    managerEntryFee: number,
    platformExitFee: number,
    managerExitFee: number,
    platformPerformanceFee: number,
    managerPerformanceFee: number,
    platformManagementFee: number,
    managerManagementFee: number,
};

export type FundConfig = {
    teaVaultV2: string,
    disableNFTChecks: boolean,
    disableDepositing: boolean,
    disableWithdrawing: boolean,
    disableCancelDepositing: boolean,
    disableCancelWithdrawing: boolean,
};

export type GlobalState = {
    depositLimit: ethers.BigNumber,
    lockedAssets: ethers.BigNumber,
    cycleIndex: number,
    cycleStartTimestamp: ethers.BigNumber,
    fundingLockTimestamp: ethers.BigNumber,
    fundClosed: boolean,
};

export type CycleState = {
    totalFundValue: ethers.BigNumber,
    fundValueAfterRequests: ethers.BigNumber,
    requestedDeposits: ethers.BigNumber,
    convertedDeposits: ethers.BigNumber,
    requestedWithdrawals: ethers.BigNumber,
    convertedWithdrawals: ethers.BigNumber,
};

export type VaultInfoItem = {
    assetInfo: AssetInfo,
    fundConfig: FundConfig,
    feeConfig: FeeConfig,
    globalState: GlobalState,
    latestCycleState: CycleState | null,
    previousCycleState: CycleState | null,
};

const vaultAbi = [
    "function asset() public view returns (address)",
    "function feeConfig() public view returns (address platformVault, address managerVault, uint24 platformEntryFee, uint24 managerEntryFee, uint24 platformExitFee, uint24 managerExitFee, uint24 platformPerformanceFee, uint24 managerPerformanceFee, uint24 platformManagementFee, uint24 managerManagementFee)",
    "function fundConfig() public view returns (address teaVaultV2, bool disableNFTChecks, bool disableDepositing, bool disableWithdrawing, bool disableCancelDepositing, bool disableCancelWithdrawing)",
    "function globalState() public view returns (uint128 depositLimit, uint128 lockedAssets, uint32 cycleIndex, uint64 cycleStartTimestamp, uint64 fundingLockTimestamp, bool fundClosed)",
    "function cycleState(uint32) public view returns (uint128 totalFundValue, uint128 fundValueAfterRequests, uint128 requestedDeposits, uint128 convertedDeposits, uint128 requestedWithdrawals, uint128 convertedWithdrawals)",
    "event EnterNextCycle(address indexed caller, uint32 indexed cycleIndex, uint256 fundValue, uint256 priceNumerator, uint256 priceDenominator, uint256 depositLimit, uint64 startTimestamp, uint64 lockTimestamp, bool fundClosed, uint256 platformFee, uint256 managerFee)",
];

const erc20Abi = [
    "function name() public view returns (string)",
    "function symbol() public view returns (string)",
    "function decimals() public view returns (uint8)",
];


export async function getVaultInfo(vaultAddresses: string[], rpcProvider: ethers.providers.Provider): Promise<VaultInfoItem[]> {
    const multicall = new MulticallBuilder(rpcProvider);
    let results: VaultInfoItem[] = [];

    let queue = multicall.newQueue();
    let globalStateIndexes = [];
    for (let i = 0; i < vaultAddresses.length; i++) {
        const vaultAddr = vaultAddresses[i];
        const vault = new ethers.Contract(vaultAddr, vaultAbi, rpcProvider);

        const assetIndex = queue.queue(vault, 'asset');
        const globalStateIndex = queue.queue(vault, 'globalState');
        const feeConfigIndex = queue.queue(vault, 'feeConfig');
        const fundConfigIndex = queue.queue(vault, 'fundConfig');

        globalStateIndexes.push({
            assetIndex: assetIndex,
            globalStateIndex: globalStateIndex,
            feeConfigIndex: feeConfigIndex,
            fundConfigIndex: fundConfigIndex,
        });
    }

    const globalStates = await queue.execute();

    for (let i = 0; i < vaultAddresses.length; i++) {
        const assetAddr = globalStates[globalStateIndexes[i].assetIndex][0];
        const globalState = globalStates[globalStateIndexes[i].globalStateIndex];
        const feeConfig = globalStates[globalStateIndexes[i].fundConfigIndex];
        const fundConfig = globalStates[globalStateIndexes[i].fundConfigIndex];

        results.push({
            assetInfo: {
                address: assetAddr as string,
                name: '',
                symbol: '',
                decimals: 0,
            },
            globalState: globalState,
            fundConfig: fundConfig,
            feeConfig: feeConfig,
            latestCycleState: null,
            previousCycleState: null,
        });
    }

    queue = multicall.newQueue();
    let cycleStateIndexes = [];
    for (let i = 0; i < vaultAddresses.length; i++) {
        const vaultAddr = vaultAddresses[i];
        const vault = new ethers.Contract(vaultAddr, vaultAbi, rpcProvider);
        const assetAddr = results[i].assetInfo.address;
        const asset = new ethers.Contract(assetAddr, erc20Abi, rpcProvider);

        const nameIndex = queue.queue(asset, 'name');
        const symbolIndex = queue.queue(asset, 'symbol');
        const decimalsIndex = queue.queue(asset, 'decimals');

        const cycleIndex = results[i].globalState.cycleIndex;

        let latestCycleIndex = -1;
        if (cycleIndex > 0) {
            latestCycleIndex = queue.queue(vault, 'cycleState', cycleIndex - 1);
        }

        let previousCycleIndex = -1;
        if (cycleIndex > 1) {
            previousCycleIndex = queue.queue(vault, 'cycleState', cycleIndex - 2);
        }

        cycleStateIndexes.push({
            nameIndex: nameIndex,
            symbolIndex: symbolIndex,
            decimalsIndex: decimalsIndex,
            latestCycleIndex: latestCycleIndex,
            previousCycleIndex: previousCycleIndex,
        });
    }

    const cycleStates = await queue.execute();

    for (let i = 0; i < vaultAddresses.length; i++) {
        let result = results[i];

        result.assetInfo.name = cycleStates[cycleStateIndexes[i].nameIndex][0];
        result.assetInfo.symbol = cycleStates[cycleStateIndexes[i].symbolIndex][0];
        result.assetInfo.decimals = cycleStates[cycleStateIndexes[i].decimalsIndex][0];

        if (cycleStates[i].latestCycleIndex != -1) {
            result.latestCycleState = cycleStates[cycleStateIndexes[i].latestCycleIndex];
        }

        if (cycleStates[i].previousCycleIndex != -1) {
            result.previousCycleState = cycleStates[cycleStateIndexes[i].previousCycleIndex];
        }
    }

    return results;
}
