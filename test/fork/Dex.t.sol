// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ForkBase, IVibeFactory, IVibePair, IVibeRouter, IERC20, ICToken} from "./ForkBase.sol";

/// @notice Swaps and liquidity on the live Soneium Vibe factory, forked locally.
contract DexForkTest is ForkBase {
    IVibeRouter internal router;
    IVibeFactory internal liveFactory;
    IVibeFactory internal legacyFactory;

    address internal weth;
    address internal usdce;
    address internal livePair;

    function setUp() public override {
        super.setUp();
        router = IVibeRouter(LIVE_ROUTER);
        liveFactory = IVibeFactory(LIVE_FACTORY);
        legacyFactory = IVibeFactory(LEGACY_FACTORY);

        weth = router.WETH();
        usdce = ICToken(C_USDC).underlying();
        livePair = liveFactory.getPair(weth, usdce);
    }

    function test_fork_livePairHasLiquidity_legacyPairIsEmpty() public {
        assertEq(router.factory(), LIVE_FACTORY);
        assertFalse(router.paused());
        assertEq(liveFactory.getInitCodeHash(), hex"87b780b5d19df9ad0d4c866dcd6b169f14846fb24232a128b678c5bdb395b012");
        assertFalse(liveFactory.isPairCreationOpen());
        assertTrue(liveFactory.feeTo() != address(0));

        assertEq(IERC20(weth).symbol(), "WETH");
        assertEq(IERC20(usdce).symbol(), "USDC.e");

        address legacyPair = legacyFactory.getPair(weth, usdce);
        assertEq(legacyPair, LEGACY_WETH_USDCE_PAIR);
        assertEq(IVibePair(legacyPair).factory(), LEGACY_FACTORY);
        (uint112 leg0, uint112 leg1,) = IVibePair(legacyPair).getReserves();
        assertEq(leg0, 0);
        assertEq(leg1, 0);

        assertEq(livePair, 0x9726ecEB595376765f7391e16e438cfb7b8D71F2);
        assertTrue(livePair != legacyPair);
        assertEq(IVibePair(livePair).factory(), LIVE_FACTORY);
        (uint112 r0, uint112 r1,) = IVibePair(livePair).getReserves();
        assertGt(r0, 0);
        assertGt(r1, 0);

        // Empty legacy reserves cannot pay a swap. Do not seed liquidity.
        vm.expectRevert(bytes4(keccak256("VibeInsufficientLiquidity()")));
        IVibePair(legacyPair).swap(1, 0, address(this), "");
    }

    function test_fork_swapExact_wethToUsdce_matchesFeeMath() public {
        _swapExactAndCheckFee(weth, usdce, 0.01 ether);
    }

    function test_fork_swapExact_usdceToWeth_matchesFeeMath() public {
        _swapExactAndCheckFee(usdce, weth, 1_000_000); // 1 USDC.e
    }

    function test_fork_addAndRemoveLiquidity_mintsAndBurnsLp() public {
        (uint112 r0, uint112 r1,) = IVibePair(livePair).getReserves();
        assertGt(r0, 0, "live pair has no liquidity");
        assertGt(r1, 0, "live pair has no liquidity");

        address token0 = IVibePair(livePair).token0();
        address token1 = IVibePair(livePair).token1();
        uint256 amount0 = 0.01 ether;
        uint256 amount1 = amount0 * uint256(r1) / uint256(r0);
        assertGt(amount1, 0);

        address lp = makeAddr("lp");
        deal(token0, lp, amount0);
        deal(token1, lp, amount1);

        vm.startPrank(lp);
        _approve(token0, LIVE_ROUTER, amount0);
        _approve(token1, LIVE_ROUTER, amount1);
        uint256 lpBefore = IVibePair(livePair).balanceOf(lp);
        (uint256 used0, uint256 used1, uint256 liquidity) = router.addLiquidity(
            token0, token1, amount0, amount1, 1, 1, lp, block.timestamp
        );
        vm.stopPrank();

        assertGt(liquidity, 0);
        assertEq(IVibePair(livePair).balanceOf(lp) - lpBefore, liquidity);
        assertEq(used0, amount0);
        assertEq(used1, amount1);

        uint256 bal0Before = IERC20(token0).balanceOf(lp);
        uint256 bal1Before = IERC20(token1).balanceOf(lp);

        vm.startPrank(lp);
        _approve(livePair, LIVE_ROUTER, liquidity);
        (uint256 out0, uint256 out1) = router.removeLiquidity(token0, token1, liquidity, 1, 1, lp, block.timestamp);
        vm.stopPrank();

        assertEq(IVibePair(livePair).balanceOf(lp), lpBefore);
        assertGt(out0, 0);
        assertGt(out1, 0);
        assertEq(IERC20(token0).balanceOf(lp) - bal0Before, out0);
        assertEq(IERC20(token1).balanceOf(lp) - bal1Before, out1);
        // feeTo is set, so mint/burn can skim 1/6 of sqrt(k) growth. A round trip
        // therefore returns slightly less than was deposited. It does not return more.
        assertLe(out0, used0);
        assertLe(out1, used1);
        assertGt(out0 * 1000, used0 * 999);
        assertGt(out1 * 1000, used1 * 999);
    }

    function _swapExactAndCheckFee(address tokenIn, address tokenOut, uint256 amountIn) internal {
        (uint112 r0, uint112 r1,) = IVibePair(livePair).getReserves();
        if (r0 == 0 || r1 == 0) {
            address[] memory emptyPath = new address[](2);
            emptyPath[0] = tokenIn;
            emptyPath[1] = tokenOut;
            vm.expectRevert();
            router.swapExactTokensForTokens(amountIn, 0, emptyPath, address(this), block.timestamp);
            return;
        }

        address token0 = IVibePair(livePair).token0();
        uint256 reserveIn = tokenIn == token0 ? uint256(r0) : uint256(r1);
        uint256 reserveOut = tokenIn == token0 ? uint256(r1) : uint256(r0);

        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        uint256 quoted = router.getAmountsOut(amountIn, path)[1];
        uint256 formula = _amountOut(amountIn, reserveIn, reserveOut);
        assertEq(quoted, formula, "0.25% fee math");
        assertGt(quoted, 0);

        address trader = makeAddr("trader");
        deal(tokenIn, trader, amountIn);
        uint256 outBefore = IERC20(tokenOut).balanceOf(trader);

        vm.startPrank(trader);
        _approve(tokenIn, LIVE_ROUTER, amountIn);
        uint256[] memory amounts = router.swapExactTokensForTokens(amountIn, quoted, path, trader, block.timestamp);
        vm.stopPrank();

        assertEq(amounts[1], quoted);
        assertEq(IERC20(tokenOut).balanceOf(trader) - outBefore, quoted);
        assertEq(IERC20(tokenIn).balanceOf(trader), 0);
    }
}
