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
// ... (Tus ABIs existentes de C_TOKEN, MASTER, etc.)

window.ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)",
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
];

// ... (Tus otros ABIs existentes: MIN_ERC20, ROUTER, etc.) ...

// ... (otros abis)

window.ZAP_ABI = [
  {"inputs":[{"internalType":"address","name":"_router","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},
  {"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"user","type":"address"},{"indexed":true,"internalType":"address","name":"token","type":"address"},{"indexed":false,"internalType":"uint256","name":"lpAmount","type":"uint256"}],"name":"ZapETH","type":"event"},
  
  // ESTA ES LA FUNCION CLAVE: 2 PARÁMETROS
  {"inputs":[{"internalType":"address","name":"_token","type":"address"},{"internalType":"uint256","name":"_minLp","type":"uint256"}],"name":"zapInETH","outputs":[],"stateMutability":"payable","type":"function"},
  
  {"stateMutability":"payable","type":"receive"}
];

// ... (Tus otros ABIs: C_TOKEN_ABI, MIN_ERC20_ABI, etc. se mantienen igual) ...

window.MASTERCHEF_ABI = [
  {"inputs":[{"internalType":"contract IERC20","name":"_lightToken","type":"address"},{"internalType":"uint256","name":"_lightPerBlock","type":"uint256"},{"internalType":"uint256","name":"_startBlock","type":"uint256"}],"stateMutability":"nonpayable","type":"constructor"},
  {"inputs":[{"internalType":"uint256","name":"_pid","type":"uint256"},{"internalType":"uint256","name":"_amount","type":"uint256"}],"name":"deposit","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"_pid","type":"uint256"},{"internalType":"uint256","name":"_amount","type":"uint256"}],"name":"withdraw","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"_pid","type":"uint256"},{"internalType":"address","name":"_user","type":"address"}],"name":"pendingLight","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"","type":"uint256"},{"internalType":"address","name":"","type":"address"}],"name":"userInfo","outputs":[{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"uint256","name":"rewardDebt","type":"uint256"}],"stateMutability":"view","type":"function"},
  {"inputs":[],"name":"lightPerBlock","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"","type":"uint256"}],"name":"poolInfo","outputs":[{"internalType":"contract IERC20","name":"lpToken","type":"address"},{"internalType":"uint256","name":"allocPoint","type":"uint256"},{"internalType":"uint256","name":"lastRewardBlock","type":"uint256"},{"internalType":"uint256","name":"accLightPerShare","type":"uint256"}],"stateMutability":"view","type":"function"}
];
// ... (Tus ABIs anteriores) ...

window.SOUSCHEF_ABI = [
  // Lectura
  { "inputs": [{"internalType": "address", "name": "", "type": "address"}], "name": "userInfo", "outputs": [{"internalType": "uint256", "name": "amount", "type": "uint256"}, {"internalType": "uint256", "name": "rewardDebt", "type": "uint256"}], "stateMutability": "view", "type": "function" },
  { "inputs": [{"internalType": "address", "name": "_user", "type": "address"}], "name": "pendingReward", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "rewardPerBlock", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function" },
  // Escritura
  { "inputs": [{"internalType": "uint256", "name": "_amount", "type": "uint256"}], "name": "deposit", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{"internalType": "uint256", "name": "_amount", "type": "uint256"}], "name": "withdraw", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [], "name": "emergencyWithdraw", "outputs": [], "stateMutability": "nonpayable", "type": "function" }
];
// ... (Tus ABIs anteriores C_TOKEN_ABI, MASTER_ABI, etc siguen arriba)

window.STABILITY_ABI = [
  // Funciones de Lectura
  { "inputs": [], "name": "feeIn", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "feeOut", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "paused", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "reserveAsset", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "reserveCap", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "reserveDecimals", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "svusd", "outputs": [{ "internalType": "contract SVUSD", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
  
  // Funciones de Escritura
  { "inputs": [{ "internalType": "uint256", "name": "amountUSDC", "type": "uint256" }], "name": "buySVUSD", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "amountSVUSD", "type": "uint256" }], "name": "sellSVUSD", "outputs": [], "stateMutability": "nonpayable", "type": "function" }
];

window.ERC20_ABI = [
  { "inputs": [{ "internalType": "address", "name": "account", "type": "address" }], "name": "balanceOf", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "spender", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "approve", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "owner", "type": "address" }, { "internalType": "address", "name": "spender", "type": "address" }], "name": "allowance", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" }
];
// ... (Tus ABIs anteriores C_TOKEN_ABI, MASTER_ABI, etc siguen igual) ...

// AGREGA ESTO AL FINAL DE abis.js
window.CSVUSD_MINTABLE_ABI = [
  // Lectura
  { "inputs": [], "name": "borrowRatePerBlock", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "account", "type": "address" }], "name": "borrowBalance", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "interestRateModel", "outputs": [{ "internalType": "contract IInterestRateModel", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "totalSupply", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "totalBorrows", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  
  // Escritura (Minting y Burning de deuda)
  { "inputs": [{ "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "borrow", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "repay", "outputs": [], "stateMutability": "nonpayable", "type": "function" }
];

window.REWARDS_ADDRESS = "0x1126859aB6911Fc3b4f86f2F65E7B6F2eEDe5185";
