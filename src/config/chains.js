const chains = {
  hoodi: {
    name: 'Hoodi Testnet',
    chainId: 560048,
    rpcUrl: 'https://rpc.hoodi.ethpandaops.io',
    explorerUrl: 'https://hoodi.ethpandaops.io',
    nativeCurrency: 'ETH',
    contracts: {
      oracleRegistry: '',
      swapRouter: '',
      settlementVault: '',
      rewardDistributor: '',
      hiddenOrderBook: '',
      leverageEngine: '',
      lendingPool: '',
      kycRegistry: '',
      multiSigWallet: '',
      killSwitch: ''
    }
  },
  baseSepolia: {
    name: 'Base Sepolia',
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
    nativeCurrency: 'ETH',
    contracts: {
      oracleRegistry: '',
      swapRouter: '',
      settlementVault: '',
      rewardDistributor: '',
      hiddenOrderBook: '',
      leverageEngine: '',
      lendingPool: '',
      kycRegistry: '',
      multiSigWallet: '',
      killSwitch: ''
    }
  }
};

function getChainConfig(chainName) {
  const key = chainName.toLowerCase().replace(/[\s-]/g, '');
  if (key === 'hoodi' || key === 'hooditestnet') return chains.hoodi;
  if (key === 'basesepolia' || key === 'base') return chains.baseSepolia;
  return null;
}

function getAllChains() {
  return Object.values(chains);
}

module.exports = { chains, getChainConfig, getAllChains };
