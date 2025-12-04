// ABIs global para cToken, Master, ERC20, Rewards y ORACLE

window.C_TOKEN_ABI = [
  { "inputs":[], "name": "name", "outputs": [{ "internalType": "string", "name": "", "type": "string" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "symbol", "outputs": [{ "internalType": "string", "name": "", "type": "string" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "decimals", "outputs": [{ "internalType": "uint8", "name": "", "type": "uint8" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "totalSupply", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "totalBorrows", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "totalReserves", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "account", "type": "address" }], "name": "balanceOf", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "account", "type": "address" }], "name": "borrowBalance", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  
  // --- NUEVO: LIQUIDATE BORROW ---
  { 
    "inputs": [
      { "internalType": "address", "name": "borrower", "type": "address" },
      { "internalType": "uint256", "name": "repayAmount", "type": "uint256" },
      { "internalType": "address", "name": "cTokenCollateral", "type": "address" }
    ], 
    "name": "liquidateBorrow", 
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], 
    "stateMutability": "nonpayable", 
    "type": "function" 
  },

  { "inputs": [], "name": "peekRates", "outputs": [{ "internalType": "uint256", "name": "borrowRatePerBlock", "type": "uint256" }, { "internalType": "uint256", "name": "supplyRatePerBlock", "type": "uint256" }, { "internalType": "uint256", "name": "utilization", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "mint", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "cTokenAmount", "type": "uint256" }], "name": "redeem", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "borrow", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "repay", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [], "name": "underlying", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "exchangeRateStored", "outputs": [{"internalType": "uint256","name":"","type":"uint256"}], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "exchangeRateInitialMantissa", "outputs": [{"internalType": "uint256","name":"","type":"uint256"}], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "accrualBlockNumber", "outputs": [{"internalType": "uint256","name":"","type":"uint256"}], "stateMutability": "view", "type": "function" }
];

// El resto de ABIs se mantiene igual (Master, ERC20, etc.)
window.MASTER_ABI = [
  { "inputs":[{"internalType":"address[]","name":"cTokens","type":"address[]"}],"name":"enterMarkets","outputs":[],"stateMutability":"nonpayable","type":"function"},
  { "inputs":[{"internalType":"address","name":"cTokenAddress","type":"address"}],"name":"exitMarket","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},
  { "inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"getAssetsIn","outputs":[{"internalType":"address[]","name":"","type":"address[]"}],"stateMutability":"view","type":"function"},
  { "inputs":[],"name":"oracle","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},
  { "inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"getAccountLiquidity","outputs":[{"components":[{"internalType":"uint256","name":"collateralUSD","type":"uint256"},{"internalType":"uint256","name":"liquidationUSD","type":"uint256"},{"internalType":"uint256","name":"borrowUSD","type":"uint256"}],"internalType":"struct LiquidityData","name":"ld","type":"tuple"}],"stateMutability":"view","type":"function"},
  {
    "inputs": [
      {"internalType": "address", "name": "account", "type": "address"},
      {"internalType": "address", "name": "cTokenModify", "type": "address"},
      {"internalType": "uint256", "name": "redeemTokens", "type": "uint256"},
      {"internalType": "uint256", "name": "borrowAmount", "type": "uint256"}
    ],
    "name": "getHypotheticalAccountLiquidity",
    "outputs": [
      {
        "components": [
          {"internalType": "uint256", "name": "collateralUSD", "type": "uint256"},
          {"internalType": "uint256", "name": "liquidationUSD", "type": "uint256"},
          {"internalType": "uint256", "name": "borrowUSD", "type": "uint256"}
        ],
        "internalType": "struct LiquidityData",
        "name": "ldNew",
        "type": "tuple"
      },
      {"internalType": "uint256", "name": "hfMantissa", "type": "uint256"},
      {"internalType": "bool", "name": "allowed", "type": "bool"}
    ],
    "stateMutability": "view",
    "type": "function"
  },
  // Para Liquidator: Close Factor y Liquidation Incentive
  { "inputs":[], "name":"closeFactorMantissa", "outputs":[{"internalType":"uint256","name":"","type":"uint256"}], "stateMutability":"view", "type":"function" },
  { "inputs":[], "name":"liquidationIncentiveMantissa", "outputs":[{"internalType":"uint256","name":"","type":"uint256"}], "stateMutability":"view", "type":"function" }
];

window.MIN_ERC20_ABI = [
  { name:"allowance", type:"function", stateMutability:"view", inputs:[{name:"owner",type:"address"},{name:"spender",type:"address"}], outputs:[{name:"",type:"uint256"}] },
  { name:"approve", type:"function", stateMutability:"nonpayable", inputs:[{name:"spender",type:"address"},{name:"amount",type:"uint256"}], outputs:[{name:"",type:"bool"}] },
  { name:"balanceOf", type:"function", stateMutability:"view", inputs:[{name:"owner",type:"address"}], outputs:[{name:"",type:"uint256"}] },
  { name:"decimals", type:"function", stateMutability:"view", inputs:[], outputs:[{name:"",type:"uint8"}] }
];

window.REWARDS_ABI = [
  { "inputs":[{"internalType":"address","name":"user","type":"address"}], "name":"vibeAccrued", "outputs":[{"internalType":"uint256","name":"","type":"uint256"}], "stateMutability":"view", "type":"function" },
  { "inputs":[{"internalType":"address","name":"user","type":"address"}], "name":"claimVIBE", "outputs":[], "stateMutability":"nonpayable", "type":"function" },
  { "inputs":[{"internalType":"address","name":"cToken","type":"address"}], "name":"vibeSupplySpeed", "outputs":[{"internalType":"uint256","name":"","type":"uint256"}], "stateMutability":"view", "type":"function" },
  { "inputs":[{"internalType":"address","name":"cToken","type":"address"}], "name":"vibeBorrowSpeed", "outputs":[{"internalType":"uint256","name":"","type":"uint256"}], "stateMutability":"view", "type":"function" },
  { "inputs":[], "name":"vibeTokenExternal", "outputs":[{"internalType":"address","name":"","type":"address"}], "stateMutability":"view", "type":"function" }
];

window.ORACLE_ABI = [
  {
    "inputs": [{ "internalType": "address", "name": "asset", "type": "address" }],
    "name": "getUnderlyingPrice",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
];

window.REWARDS_ADDRESS = "0x2F38ecB638DC4fB636A85167C203d791f2809E60";
