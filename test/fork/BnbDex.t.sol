// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

/// @notice Live BNB Chain SoneVibe DEX addresses. Fork URL is `BSC_RPC_URL`, or the public dataseed.
library BnbDex {
    address internal constant FACTORY = 0x26b13e7e923e964b0514B3167A90901B49DAe205;
    address internal constant ROUTER = 0xa393E76bE079cF1ccf684D0f815795Dde248f157;
    address internal constant WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    address internal constant ETH = 0x2170Ed0880ac9A755fd29B2688956BD959F933F8;
    address internal constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    address internal constant PAIR_ETH_USDT = 0x93016Fa6e3c184c96Df7466579DfaA970C7cb6A5;
    address internal constant PAIR_USDT_WBNB = 0x6dABcbFdFE097e421269a444eBF22999B1EAE279;
    bytes32 internal constant INIT_CODE_HASH = hex"87b780b5d19df9ad0d4c866dcd6b169f14846fb24232a128b678c5bdb395b012";
    string internal constant PUBLIC_RPC = "https://bsc-dataseed.bnbchain.org";

    function rpc(Vm vm) internal view returns (string memory url) {
        url = vm.envOr("BSC_RPC_URL", PUBLIC_RPC);
        if (bytes(url).length == 0) url = PUBLIC_RPC;
    }
}

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

interface IBnbFactory {
    function getPair(address tokenA, address tokenB) external view returns (address);
    function feeTo() external view returns (address);
    function feeToSetter() external view returns (address);
    function owner() external view returns (address);
    function paused() external view returns (bool);
    function isPairCreationOpen() external view returns (bool);
    function getInitCodeHash() external view returns (bytes32);
    function setFeeTo(address) external;
    function setFeeToSetter(address) external;
    function setPairCreationStatus(bool) external;
    function createPair(address tokenA, address tokenB) external returns (address);
    function pause() external;
    function unpause() external;
    function transferOwnership(address) external;
    function renounceOwnership() external;
}

interface IBnbRouter {
    function factory() external view returns (address);
    function WETH() external view returns (address);
    function owner() external view returns (address);
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
    function pause() external;
    function unpause() external;
    function rescueFunds(address token) external;
    function transferOwnership(address) external;
    function renounceOwnership() external;
}

interface IBnbPair {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function factory() external view returns (address);
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

abstract contract BnbFork is Test {
    IBnbFactory internal factory;
    IBnbRouter internal router;

    function setUp() public virtual {
        vm.createSelectFork(BnbDex.rpc(vm));
        assertEq(block.chainid, 56);
        factory = IBnbFactory(BnbDex.FACTORY);
        router = IBnbRouter(BnbDex.ROUTER);
    }

    function _approve(address token, address spender, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "approve failed");
    }

    /// @dev 0.25% fee: amountIn * 9975 / 10000. Same integer math as VibeLibrary.getAmountOut.
    function _amountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        uint256 amountInWithFee = amountIn * 9975;
        return (amountInWithFee * reserveOut) / (reserveIn * 10000 + amountInWithFee);
    }

    function _pairFor(address tokenA, address tokenB) internal pure returns (address) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        return address(uint160(uint256(keccak256(abi.encodePacked(hex"ff", BnbDex.FACTORY, salt, BnbDex.INIT_CODE_HASH)))));
    }

    function _reserves(address pair, address tokenIn)
        internal
        view
        returns (uint256 reserveIn, uint256 reserveOut)
    {
        (uint112 r0, uint112 r1,) = IBnbPair(pair).getReserves();
        if (tokenIn == IBnbPair(pair).token0()) return (uint256(r0), uint256(r1));
        return (uint256(r1), uint256(r0));
    }
}

/// @notice Forked checks against the live BNB factory, router, and pairs.
contract BnbDexForkTest is BnbFork {
    function test_fork_pairForAndInitCodeHashMatchDeployedPairs() public view {
        assertEq(router.factory(), BnbDex.FACTORY);
        assertEq(router.WETH(), BnbDex.WBNB);
        assertEq(factory.getInitCodeHash(), BnbDex.INIT_CODE_HASH);

        assertEq(_pairFor(BnbDex.ETH, BnbDex.USDT), BnbDex.PAIR_ETH_USDT);
        assertEq(_pairFor(BnbDex.USDT, BnbDex.ETH), BnbDex.PAIR_ETH_USDT);
        assertEq(factory.getPair(BnbDex.ETH, BnbDex.USDT), BnbDex.PAIR_ETH_USDT);
        assertEq(IBnbPair(BnbDex.PAIR_ETH_USDT).factory(), BnbDex.FACTORY);
        assertEq(IBnbPair(BnbDex.PAIR_ETH_USDT).token0(), BnbDex.ETH);
        assertEq(IBnbPair(BnbDex.PAIR_ETH_USDT).token1(), BnbDex.USDT);

        assertEq(_pairFor(BnbDex.USDT, BnbDex.WBNB), BnbDex.PAIR_USDT_WBNB);
        assertEq(_pairFor(BnbDex.WBNB, BnbDex.USDT), BnbDex.PAIR_USDT_WBNB);
        assertEq(factory.getPair(BnbDex.WBNB, BnbDex.USDT), BnbDex.PAIR_USDT_WBNB);
        assertEq(IBnbPair(BnbDex.PAIR_USDT_WBNB).factory(), BnbDex.FACTORY);
        assertEq(IBnbPair(BnbDex.PAIR_USDT_WBNB).token0(), BnbDex.USDT);
        assertEq(IBnbPair(BnbDex.PAIR_USDT_WBNB).token1(), BnbDex.WBNB);
    }

    function test_fork_getAmountsOutMatchesReservesWithQuarterPercentFee() public view {
        _assertQuote(BnbDex.PAIR_ETH_USDT, BnbDex.ETH, BnbDex.USDT);
        _assertQuote(BnbDex.PAIR_ETH_USDT, BnbDex.USDT, BnbDex.ETH);
        _assertQuote(BnbDex.PAIR_USDT_WBNB, BnbDex.USDT, BnbDex.WBNB);
        _assertQuote(BnbDex.PAIR_USDT_WBNB, BnbDex.WBNB, BnbDex.USDT);
    }

    function test_fork_swapExactOnRouter() public {
        assertFalse(router.paused());
        (uint256 reserveIn, uint256 reserveOut) = _reserves(BnbDex.PAIR_ETH_USDT, BnbDex.ETH);
        uint256 amountIn = reserveIn / 100;
        assertGt(amountIn, 0);

        address[] memory path = new address[](2);
        path[0] = BnbDex.ETH;
        path[1] = BnbDex.USDT;
        uint256 quoted = router.getAmountsOut(amountIn, path)[1];
        assertEq(quoted, _amountOut(amountIn, reserveIn, reserveOut));
        assertGt(quoted, 0);
        assertLt(quoted, reserveOut);

        address trader = makeAddr("trader");
        deal(BnbDex.ETH, trader, amountIn);
        uint256 outBefore = IERC20(BnbDex.USDT).balanceOf(trader);

        vm.startPrank(trader);
        _approve(BnbDex.ETH, BnbDex.ROUTER, amountIn);
        uint256[] memory amounts = router.swapExactTokensForTokens(amountIn, quoted, path, trader, block.timestamp);
        vm.stopPrank();

        assertEq(amounts[1], quoted);
        assertEq(IERC20(BnbDex.USDT).balanceOf(trader) - outBefore, quoted);
        assertEq(IERC20(BnbDex.ETH).balanceOf(trader), 0);
    }

    function test_fork_addAndRemoveLiquidity() public {
        assertFalse(router.paused());
        (uint112 r0, uint112 r1,) = IBnbPair(BnbDex.PAIR_ETH_USDT).getReserves();
        assertGt(r0, 0);
        assertGt(r1, 0);

        address token0 = IBnbPair(BnbDex.PAIR_ETH_USDT).token0();
        address token1 = IBnbPair(BnbDex.PAIR_ETH_USDT).token1();
        uint256 amount0 = uint256(r0) / 100;
        uint256 amount1 = amount0 * uint256(r1) / uint256(r0);
        assertGt(amount0, 0);
        assertGt(amount1, 0);

        address lp = makeAddr("lp");
        deal(token0, lp, amount0);
        deal(token1, lp, amount1);

        vm.startPrank(lp);
        _approve(token0, BnbDex.ROUTER, amount0);
        _approve(token1, BnbDex.ROUTER, amount1);
        uint256 lpBefore = IBnbPair(BnbDex.PAIR_ETH_USDT).balanceOf(lp);
        (uint256 used0, uint256 used1, uint256 liquidity) = router.addLiquidity(
            token0, token1, amount0, amount1, 1, 1, lp, block.timestamp
        );
        vm.stopPrank();

        assertGt(liquidity, 0);
        assertEq(IBnbPair(BnbDex.PAIR_ETH_USDT).balanceOf(lp) - lpBefore, liquidity);
        assertEq(used0, amount0);
        assertEq(used1, amount1);

        uint256 bal0Before = IERC20(token0).balanceOf(lp);
        uint256 bal1Before = IERC20(token1).balanceOf(lp);

        vm.startPrank(lp);
        _approve(BnbDex.PAIR_ETH_USDT, BnbDex.ROUTER, liquidity);
        (uint256 out0, uint256 out1) =
            router.removeLiquidity(token0, token1, liquidity, 1, 1, lp, block.timestamp);
        vm.stopPrank();

        assertEq(IBnbPair(BnbDex.PAIR_ETH_USDT).balanceOf(lp), lpBefore);
        assertGt(out0, 0);
        assertGt(out1, 0);
        assertEq(IERC20(token0).balanceOf(lp) - bal0Before, out0);
        assertEq(IERC20(token1).balanceOf(lp) - bal1Before, out1);
        // feeTo mints LP on mint/burn from sqrt(k) growth. A same-transaction round trip
        // returns the deposit within rounding, and does not return more than was sent.
        assertLe(out0, used0);
        assertLe(out1, used1);
        assertGt(out0 * 1000, used0 * 999);
        assertGt(out1 * 1000, used1 * 999);
    }

    function test_fork_feeToAndFeeToSetterReadable() public view {
        address feeTo = factory.feeTo();
        address setter = factory.feeToSetter();
        assertTrue(setter != address(0));
        assertTrue(factory.owner() != address(0));
        assertTrue(router.owner() != address(0));
        assertEq(factory.feeTo(), feeTo);
        assertEq(factory.feeToSetter(), setter);
    }

    /// @dev Admin calls are pranked as the live owner and feeToSetter. Those are the only
    ///      senders the functions accept. Token balances are dealt only to the router, never
    ///      to a pair, and only so `rescueFunds` has something to pull off the router itself.
    function test_fork_adminFunctionsCannotMovePairTokens() public {
        uint256[4] memory beforeBalances = _pairTokenBalances();
        assertGt(beforeBalances[0], 0);
        assertGt(beforeBalances[1], 0);
        assertGt(beforeBalances[2], 0);
        assertGt(beforeBalances[3], 0);

        _exerciseFeeToSetter();
        _exerciseOwners();
        _exerciseRouterRescue();
        _exerciseLegacyDrainSelectors();

        uint256[4] memory afterBalances = _pairTokenBalances();
        assertEq(afterBalances[0], beforeBalances[0]);
        assertEq(afterBalances[1], beforeBalances[1]);
        assertEq(afterBalances[2], beforeBalances[2]);
        assertEq(afterBalances[3], beforeBalances[3]);
    }

    function _pairTokenBalances() internal view returns (uint256[4] memory balances) {
        balances[0] = IERC20(BnbDex.ETH).balanceOf(BnbDex.PAIR_ETH_USDT);
        balances[1] = IERC20(BnbDex.USDT).balanceOf(BnbDex.PAIR_ETH_USDT);
        balances[2] = IERC20(BnbDex.USDT).balanceOf(BnbDex.PAIR_USDT_WBNB);
        balances[3] = IERC20(BnbDex.WBNB).balanceOf(BnbDex.PAIR_USDT_WBNB);
    }

    function _exerciseFeeToSetter() internal {
        address setter = factory.feeToSetter();
        address feeTo = factory.feeTo();
        // The invariant handler pranks feeToSetter from outside the test contract.
        BnbAdminHandler handler = new BnbAdminHandler();
        handler.setFeeTo(address(0xBEEF));
        assertEq(factory.feeTo(), address(0xBEEF));
        handler.setFeeTo(feeTo);

        bool wasOpen = factory.isPairCreationOpen();
        vm.startPrank(setter);
        factory.setFeeTo(address(0xBEEF));
        assertEq(factory.feeTo(), address(0xBEEF));
        factory.setFeeTo(feeTo);
        factory.setFeeToSetter(setter);
        factory.setPairCreationStatus(true);
        assertTrue(factory.isPairCreationOpen());
        factory.setPairCreationStatus(wasOpen);
        address created = factory.createPair(makeAddr("freshA"), makeAddr("freshB"));
        vm.stopPrank();
        assertTrue(created != address(0));
        assertTrue(created != BnbDex.PAIR_ETH_USDT);
        assertTrue(created != BnbDex.PAIR_USDT_WBNB);
    }

    function _exerciseOwners() internal {
        address factoryOwner = factory.owner();
        vm.startPrank(factoryOwner);
        if (factory.paused()) factory.unpause();
        factory.pause();
        assertTrue(factory.paused());
        factory.unpause();
        assertFalse(factory.paused());
        factory.transferOwnership(factoryOwner);
        vm.stopPrank();
        assertEq(factory.owner(), factoryOwner);

        address routerOwner = router.owner();
        vm.startPrank(routerOwner);
        if (router.paused()) router.unpause();
        router.pause();
        assertTrue(router.paused());
        router.unpause();
        assertFalse(router.paused());
        router.transferOwnership(routerOwner);
        vm.stopPrank();
        assertEq(router.owner(), routerOwner);
    }

    function _exerciseRouterRescue() internal {
        address routerOwner = router.owner();
        uint256 gift = 1 ether;
        deal(BnbDex.WBNB, BnbDex.ROUTER, gift);
        assertEq(IERC20(BnbDex.WBNB).balanceOf(BnbDex.ROUTER), gift);
        uint256 ownerWbnb = IERC20(BnbDex.WBNB).balanceOf(routerOwner);
        vm.prank(routerOwner);
        router.rescueFunds(BnbDex.WBNB);
        assertEq(IERC20(BnbDex.WBNB).balanceOf(BnbDex.ROUTER), 0);
        assertEq(IERC20(BnbDex.WBNB).balanceOf(routerOwner), ownerWbnb + gift);

        vm.prank(routerOwner);
        vm.expectRevert(bytes("No ETH to rescue"));
        router.rescueFunds(address(0));
    }

    function _exerciseLegacyDrainSelectors() internal {
        address thief = makeAddr("thief");
        vm.prank(BnbDex.FACTORY);
        (bool drained,) = BnbDex.PAIR_ETH_USDT.call(
            abi.encodeWithSignature("emergencyDrain(address,address)", BnbDex.ETH, thief)
        );
        assertFalse(drained);
        vm.prank(factory.feeToSetter());
        (bool rescued,) = BnbDex.FACTORY.call(
            abi.encodeWithSignature(
                "rescueFundsFromPair(address,address,address)", BnbDex.PAIR_USDT_WBNB, BnbDex.WBNB, thief
            )
        );
        assertFalse(rescued);
        assertEq(IERC20(BnbDex.ETH).balanceOf(thief), 0);
        assertEq(IERC20(BnbDex.WBNB).balanceOf(thief), 0);
    }

    function _assertQuote(address pair, address tokenIn, address tokenOut) internal view {
        (uint256 reserveIn, uint256 reserveOut) = _reserves(pair, tokenIn);
        assertGt(reserveIn, 100);
        assertGt(reserveOut, 100);
        uint256 amountIn = reserveIn / 100;

        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        uint256 quoted = router.getAmountsOut(amountIn, path)[1];
        assertEq(quoted, _amountOut(amountIn, reserveIn, reserveOut), "0.25% fee math");
        assertGt(quoted, 0);
        assertLt(quoted, reserveOut);

        uint256 uniFee = amountIn * 997;
        uint256 uniOut = (uniFee * reserveOut) / (reserveIn * 1000 + uniFee);
        assertGt(quoted, uniOut, "0.25% pays more than Uniswap 0.30%");
    }
}

/// @notice Fuzzes factory and router admin calls. Pair token balances must stay put.
contract BnbAdminHandler {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    IBnbFactory internal constant factory = IBnbFactory(BnbDex.FACTORY);
    IBnbRouter internal constant router = IBnbRouter(BnbDex.ROUTER);

    uint256 public startEth0;
    uint256 public startEth1;
    uint256 public startWbnb0;
    uint256 public startWbnb1;

    constructor() {
        startEth0 = IERC20(BnbDex.ETH).balanceOf(BnbDex.PAIR_ETH_USDT);
        startEth1 = IERC20(BnbDex.USDT).balanceOf(BnbDex.PAIR_ETH_USDT);
        startWbnb0 = IERC20(BnbDex.USDT).balanceOf(BnbDex.PAIR_USDT_WBNB);
        startWbnb1 = IERC20(BnbDex.WBNB).balanceOf(BnbDex.PAIR_USDT_WBNB);
    }

    function setFeeTo(address next) external {
        vm.prank(factory.feeToSetter());
        try factory.setFeeTo(next) {} catch {}
    }

    function setFeeToSetter(address next) external {
        vm.prank(factory.feeToSetter());
        try factory.setFeeToSetter(next) {} catch {}
    }

    function setPairCreationStatus(bool open) external {
        vm.prank(factory.feeToSetter());
        try factory.setPairCreationStatus(open) {} catch {}
    }

    function createPair(address tokenA, address tokenB) external {
        vm.prank(factory.feeToSetter());
        try factory.createPair(tokenA, tokenB) returns (address) {} catch {}
    }

    function pauseFactory() external {
        vm.prank(factory.owner());
        try factory.pause() {} catch {}
    }

    function unpauseFactory() external {
        vm.prank(factory.owner());
        try factory.unpause() {} catch {}
    }

    function transferFactoryOwner(address next) external {
        vm.prank(factory.owner());
        try factory.transferOwnership(next) {} catch {}
    }

    function renounceFactoryOwner() external {
        vm.prank(factory.owner());
        try factory.renounceOwnership() {} catch {}
    }

    function pauseRouter() external {
        vm.prank(router.owner());
        try router.pause() {} catch {}
    }

    function unpauseRouter() external {
        vm.prank(router.owner());
        try router.unpause() {} catch {}
    }

    function transferRouterOwner(address next) external {
        vm.prank(router.owner());
        try router.transferOwnership(next) {} catch {}
    }

    function renounceRouterOwner() external {
        vm.prank(router.owner());
        try router.renounceOwnership() {} catch {}
    }

    function rescueFunds(address token) external {
        vm.prank(router.owner());
        try router.rescueFunds(token) {} catch {}
    }

    function legacyDrain(address token, address to) external {
        vm.prank(BnbDex.FACTORY);
        (bool drained,) =
            BnbDex.PAIR_ETH_USDT.call(abi.encodeWithSignature("emergencyDrain(address,address)", token, to));
        drained;
        vm.prank(BnbDex.FACTORY);
        (bool drainedB,) =
            BnbDex.PAIR_USDT_WBNB.call(abi.encodeWithSignature("emergencyDrain(address,address)", token, to));
        drainedB;
        vm.prank(factory.feeToSetter());
        (bool rescued,) = BnbDex.FACTORY.call(
            abi.encodeWithSignature("rescueFundsFromPair(address,address,address)", BnbDex.PAIR_ETH_USDT, token, to)
        );
        rescued;
    }
}

/// forge-config: default.invariant.runs = 16
/// forge-config: default.invariant.depth = 8
contract BnbAdminInvariantTest is BnbFork {
    BnbAdminHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new BnbAdminHandler();
        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](14);
        selectors[0] = handler.setFeeTo.selector;
        selectors[1] = handler.setFeeToSetter.selector;
        selectors[2] = handler.setPairCreationStatus.selector;
        selectors[3] = handler.createPair.selector;
        selectors[4] = handler.pauseFactory.selector;
        selectors[5] = handler.unpauseFactory.selector;
        selectors[6] = handler.transferFactoryOwner.selector;
        selectors[7] = handler.renounceFactoryOwner.selector;
        selectors[8] = handler.pauseRouter.selector;
        selectors[9] = handler.unpauseRouter.selector;
        selectors[10] = handler.transferRouterOwner.selector;
        selectors[11] = handler.renounceRouterOwner.selector;
        selectors[12] = handler.rescueFunds.selector;
        selectors[13] = handler.legacyDrain.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_adminCannotMovePairTokens() public view {
        assertEq(IERC20(BnbDex.ETH).balanceOf(BnbDex.PAIR_ETH_USDT), handler.startEth0());
        assertEq(IERC20(BnbDex.USDT).balanceOf(BnbDex.PAIR_ETH_USDT), handler.startEth1());
        assertEq(IERC20(BnbDex.USDT).balanceOf(BnbDex.PAIR_USDT_WBNB), handler.startWbnb0());
        assertEq(IERC20(BnbDex.WBNB).balanceOf(BnbDex.PAIR_USDT_WBNB), handler.startWbnb1());
    }
}
