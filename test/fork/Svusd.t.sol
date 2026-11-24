// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ForkBase, ICToken, IComptroller, IERC20, IStabilityModule, ISVUSD} from "./ForkBase.sol";

/// @notice SVUSD mint and burn. The token itself only mints for facilitators.
///         Both facilitators are exercised: the stability module (USDC.e in and out)
///         and cSVUSD (borrow mints, repay burns).
contract SvusdForkTest is ForkBase {
    function test_fork_stabilityModule_mintAndRedeem() public {
        _assertModuleReady();
        uint256 bought = _buySvusd(1_000_000_000);
        _sellSvusd(bought);
    }

    function _assertModuleReady() internal view {
        IStabilityModule sm = IStabilityModule(STABILITY);
        ISVUSD svusd = ISVUSD(SVUSD_TOKEN);
        assertEq(address(sm.svusd()), SVUSD_TOKEN);
        assertFalse(sm.paused());
        assertFalse(svusd.paused());
        assertTrue(svusd.isFacilitator(STABILITY));
        (uint128 capacity, uint128 level) = svusd.facilitatorState(STABILITY);
        assertGt(capacity, 0);
        assertEq(level, 0);
        address reserve = sm.reserveAsset();
        assertEq(reserve, ICToken(C_USDC).underlying());
        assertEq(IERC20(reserve).symbol(), "USDC.e");
        // At the pinned block the module holds no reserve, so a redeem cannot pay
        // until someone deposits. The buy below is that deposit.
        assertEq(IERC20(reserve).balanceOf(STABILITY), 0);
        assertEq(sm.feeIn(), 10);
        assertEq(sm.feeOut(), 10);
    }

    function _buySvusd(uint256 amountUSDC) internal returns (uint256 netSv) {
        IStabilityModule sm = IStabilityModule(STABILITY);
        uint256 scale = 10 ** (18 - sm.reserveDecimals());
        uint256 grossSv = amountUSDC * scale;
        netSv = grossSv - (grossSv * sm.feeIn()) / 10_000;

        address user = makeAddr("svusd-buyer");
        address reserve = sm.reserveAsset();
        deal(reserve, user, amountUSDC);
        vm.startPrank(user);
        _approve(reserve, STABILITY, amountUSDC);
        sm.buySVUSD(amountUSDC);
        vm.stopPrank();

        assertEq(ISVUSD(SVUSD_TOKEN).balanceOf(user), netSv);
        assertEq(IERC20(reserve).balanceOf(STABILITY), amountUSDC);
    }

    function _sellSvusd(uint256 netSv) internal {
        IStabilityModule sm = IStabilityModule(STABILITY);
        address user = makeAddr("svusd-buyer");
        address reserve = sm.reserveAsset();
        uint256 scale = 10 ** (18 - sm.reserveDecimals());
        uint256 grossUsdc = netSv / scale;
        uint256 netUsdc = grossUsdc - (grossUsdc * sm.feeOut()) / 10_000;
        uint256 feeSv = (netSv * sm.feeIn()) / (10_000 - sm.feeIn());

        vm.startPrank(user);
        _approve(SVUSD_TOKEN, STABILITY, netSv);
        sm.sellSVUSD(netSv);
        vm.stopPrank();

        assertEq(ISVUSD(SVUSD_TOKEN).balanceOf(user), 0);
        assertEq(IERC20(reserve).balanceOf(user), netUsdc);
        assertEq(IERC20(reserve).balanceOf(STABILITY), 1_000_000_000 - grossUsdc);
        assertEq(ISVUSD(SVUSD_TOKEN).balanceOf(sm.treasury()), feeSv);
    }

    function test_fork_cSvusdBorrowMintsAndRepayBurns() public {
        ISVUSD svusd = ISVUSD(SVUSD_TOKEN);
        assertTrue(svusd.isFacilitator(C_SVUSD));
        assertEq(ICToken(C_SVUSD).exchangeRateStored(), 1e18);
        assertEq(IComptroller(COMPTROLLER).marketCollateralFactorMantissa(C_SVUSD), 0);

        address user = makeAddr("svusd-borrower");
        address usdc = ICToken(C_USDC).underlying();
        uint256 supplied = 100_000_000; // 100 USDC.e
        uint256 borrowAmount = 10 ether;

        deal(usdc, user, supplied);
        vm.startPrank(user);
        _approve(usdc, C_USDC, supplied);
        ICToken(C_USDC).mint(supplied);

        address[] memory markets = new address[](2);
        markets[0] = C_USDC;
        markets[1] = C_SVUSD;
        IComptroller(COMPTROLLER).enterMarkets(markets);

        uint256 supplyBefore = svusd.totalSupply();
        ICToken(C_SVUSD).borrow(borrowAmount);
        assertEq(svusd.balanceOf(user), borrowAmount);
        assertEq(svusd.totalSupply(), supplyBefore + borrowAmount);
        assertEq(ICToken(C_SVUSD).borrowBalance(user), borrowAmount);

        _approve(SVUSD_TOKEN, C_SVUSD, borrowAmount);
        ICToken(C_SVUSD).repay(borrowAmount);
        vm.stopPrank();

        assertEq(svusd.balanceOf(user), 0);
        assertEq(svusd.totalSupply(), supplyBefore);
        assertEq(ICToken(C_SVUSD).borrowBalance(user), 0);
    }
}
