// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IV_cTokenExtended} from "../../contracts/IV_cTokenExtended.sol";
import {IVibePriceOracle} from "../../contracts/IVibePriceOracle.sol";
import {LiquidityData} from "../../contracts/V_MasterTypes.sol";

/// @dev Deployed cToken surface used by the fork tests. Extends the compilable
///      interface in contracts/ with the calls these tests actually make.
interface ICToken is IV_cTokenExtended {
    function accrueInterest() external;
    function underlying() external view returns (address);
    function comptroller() external view returns (address);
    function interestRateModel() external view returns (address);
    function borrowIndex() external view returns (uint256);
    function internalCash() external view returns (uint256);
}

interface IComptroller {
    function enterMarkets(address[] calldata cTokens) external;
    function getAccountLiquidity(address account) external view returns (LiquidityData memory);
    function closeFactorMantissa() external view returns (uint256);
    function liquidationIncentiveMantissa() external view returns (uint256);
    function oracle() external view returns (address);
    function getImplementation() external view returns (address);
    function allMarkets(uint256) external view returns (address);
    function marketCollateralFactorMantissa(address) external view returns (uint256);
    function marketLiquidationThresholdMantissa(address) external view returns (uint256);
    function accountMembership(address, address) external view returns (bool);
    function markets(address) external view returns (bool);
    function borrowPaused() external view returns (bool);
    function redeemPaused() external view returns (bool);
    function liquidatePaused() external view returns (bool);
    function mintPaused(address) external view returns (bool);
    function borrowPausedMarket(address) external view returns (bool);
    function marketFrozen(address) external view returns (bool);
}

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
}

interface IVibeFactory {
    function getPair(address tokenA, address tokenB) external view returns (address);
    function feeTo() external view returns (address);
    function allPairsLength() external view returns (uint256);
    function isPairCreationOpen() external view returns (bool);
    function getInitCodeHash() external pure returns (bytes32);
}

interface IVibePair {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function factory() external view returns (address);
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

interface IVibeRouter {
    function factory() external view returns (address);
    function WETH() external view returns (address);
    function paused() external view returns (bool);
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory);
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory);
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB);
}

interface IStabilityModule {
    function buySVUSD(uint256 amountUSDC) external;
    function sellSVUSD(uint256 amountSVUSD) external;
    function paused() external view returns (bool);
    function feeIn() external view returns (uint256);
    function feeOut() external view returns (uint256);
    function reserveAsset() external view returns (address);
    function reserveDecimals() external view returns (uint256);
    function reserveCap() external view returns (uint256);
    function svusd() external view returns (address);
    function treasury() external view returns (address);
}

interface ISVUSD {
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function paused() external view returns (bool);
    function isFacilitator(address) external view returns (bool);
    function facilitatorState(address) external view returns (uint128 bucketCapacity, uint128 bucketLevel);
}

/// @notice Shared Soneium fork setup. Addresses are the live ones from contracts/README.md.
abstract contract ForkBase is Test {
    /// @dev Recent Soneium block pinned so every run reads the same state.
    uint256 internal constant FORK_BLOCK = 31_211_000;

    address internal constant COMPTROLLER = 0x1126859aB6911Fc3b4f86f2F65E7B6F2eEDe5185;
    address internal constant COMPTROLLER_IMPL = 0x95Fd3B75EF4BaFc6c621abc0B08F6b016F672401;
    address internal constant ORACLE = 0x6EC1403e2962332205817523f241E34fd41c81CB;
    address internal constant C_ASTR = 0x7CA06966B0c07C5e35aA180643E98bB3057EBb27;
    address internal constant C_USDSC = 0xDB3e66b87c42C7F3599fbdcBFe08DfF0689A6D77;
    address internal constant C_USDC = 0x96ae93Df119c131469b38e3d558899F23678dCFb;
    address internal constant C_SVUSD = 0x65f059eA5C90daE2BbF37a1A8c93A6C843255452;
    address internal constant JUMP_IRM = 0x91414eD684F78B7401C438400E755069DC007CFf;
    address internal constant FIXED_IRM = 0x31526a94797fF50aF30A7ECDA16C459E4A8fc561;
    address internal constant SVUSD_TOKEN = 0xcEca29F5f722a2922237c4D2b6Fe46Fa274B190B;
    address internal constant STABILITY = 0x7F1aF1382899263aF50Bc6d3601bdaB1E17Ba20D;
    address internal constant LIVE_FACTORY = 0x77b141dCFDa726e239efF005E3DE7A47AeBFf948;
    address internal constant LIVE_ROUTER = 0x97C180C2e3097f28D8F14114AD1C0dEF81244344;
    address internal constant LEGACY_FACTORY = 0x06C0b58287794a0bdce20ce768b601CA974618DC;
    /// @dev Legacy WETH/USDC.e pair. Confirmed on the fork via the legacy factory's getPair.
    address internal constant LEGACY_WETH_USDCE_PAIR = 0xc58ce2E71D0D64fC016DbB826714530B475adc0C;

    function setUp() public virtual {
        vm.createSelectFork(vm.rpcUrl("soneium"), FORK_BLOCK);
        assertEq(block.chainid, 1868);
        assertEq(block.number, FORK_BLOCK);
    }

    function _approve(address token, address spender, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "approve failed");
    }

    /// @dev 0.25% swap fee: amountIn * 9975 / 10000. Same integer math as VibeLibrary.getAmountOut.
    function _amountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        uint256 amountInWithFee = amountIn * 9975;
        return (amountInWithFee * reserveOut) / (reserveIn * 10000 + amountInWithFee);
    }
}
