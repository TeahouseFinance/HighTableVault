// Multicall helper library
// Teahouse Finance


import { ethers } from 'ethers';


const multicallAbi = [
    "function aggregate((address address,bytes call)[] memory calls) view returns (uint256 blockNumber, bytes[] memory returnData)",
    "function getEthBalance(address addr) view returns (uint256 balance)"
];

type AddressMap = {
    [key: number]: string
};

const MULTICALL_ADDRS: AddressMap = {
    1: '0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696',
    10: '0xeAa6877139d436Dc6d1f75F3aF15B74662617B2C',          // optimism
    42161: '0x7a7443f8c577d537f1d8cd4a629d40a3148dd7ee',       // arbitrum
};

type CallQueueItem = {
    address: string,
    call: string
};

type DecoderItem = {
    interface: ethers.utils.Interface,
    fragment: string | ethers.utils.FunctionFragment
};


export interface MulticallQueue {
    queue: (contract: ethers.Contract, fragment: string | ethers.utils.FunctionFragment, ...args: readonly any[]) => number;
    queueInterface: (contractInterface: ethers.utils.Interface, address: string, fragment: string | ethers.utils.FunctionFragment, ...args: readonly any[]) => number;
    execute: () => Promise<any[]>;
}

export class MulticallBuilder {

    private provider: ethers.providers.Provider;
    private address: string | undefined;
    private contract: ethers.Contract | undefined;

    private static Queue = class {

        private builder: MulticallBuilder;
        private callQueue: CallQueueItem[] = [];
        private decoders: DecoderItem[] = [];
        private frozen = false;
    
        constructor(builder: MulticallBuilder) {
            this.builder = builder;
        }
    
        public queue(contract: ethers.Contract, fragment: string | ethers.utils.FunctionFragment, ...args: readonly any[]): number {
            return this.internalQueue(contract.interface, contract.address, fragment, args);
        }
    
        public queueInterface(contractInterface: ethers.utils.Interface, address: string, fragment: string | ethers.utils.FunctionFragment, ...args: readonly any[]): number {
            return this.internalQueue(contractInterface, address, fragment, args);
        }
    
        public async execute(): Promise<any[]> {
            let results = [];

            this.frozen = true;
    
            await this.builder.setupContract();
    
            if (this.builder.contract != undefined) {
                // use multicall contract
                const rawResults = await this.builder.contract!.aggregate(this.callQueue);
                for(let i = 0; i < this.decoders.length; i++) {
                    results.push(this.decoders[i].interface.decodeFunctionResult(this.decoders[i].fragment, rawResults.returnData[i]));
                }
            }
            else {
                // do not have multicall contract, do it separately
                let promises = [];
                for(let i = 0; i < this.decoders.length; i++) {
                    const callQueue = this.callQueue[i];
                    const returnDataPromise = this.builder.provider.call({
                        to: callQueue.address,
                        data: callQueue.call
                    });
                    promises.push(returnDataPromise);
                }
                
                const promiseResults = await Promise.all(promises);
                for(let i = 0; i < this.decoders.length; i++) {
                    results.push(this.decoders[i].interface.decodeFunctionResult(this.decoders[i].fragment, promiseResults[i]));
                }
            }
    
            return results;
        }

        private internalQueue(contractInterface: ethers.utils.Interface, address: string, fragment: string | ethers.utils.FunctionFragment, args: readonly any[]): number {
            if (this.frozen) {
                throw new Error("Already called execute(), can't modify queue");
            }
    
            const index = this.callQueue.length;
            this.callQueue.push({
                address: address,
                call: contractInterface.encodeFunctionData(fragment, args)
            });
    
            this.decoders.push({
                interface: contractInterface,
                fragment: fragment
            });
    
            return index;
        }
    };

    constructor(provider: ethers.providers.Provider, address: string | undefined = undefined) {
        this.provider = provider;
        this.address = address;
    }
    
    // create a new queue
    public newQueue(): MulticallQueue {
        return new MulticallBuilder.Queue(this);
    }

    // returns true if multicall contract is available
    public async available(): Promise<boolean> {
        if (this.address == undefined) {
            this.address = await this.multicallAddress(this.provider);
        }

        return this.address != undefined;
    }

    private async multicallAddress(rpcProvider: ethers.providers.Provider): Promise<string | undefined> {
        const network = await rpcProvider.getNetwork();
        return MULTICALL_ADDRS[network.chainId];
    }
    
    private async setupContract() {
        if (this.contract != undefined) {
            return;            
        }

        if (this.address == undefined) {
            this.address = await this.multicallAddress(this.provider);
        }

        if (this.address != undefined) {
            this.contract = new ethers.Contract(this.address, multicallAbi, this.provider);
        }
    }
}
