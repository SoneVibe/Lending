// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ForkBase, ICToken, IComptroller, IERC20, IVibePriceOracle} from "./ForkBase.sol";

interface IJumpRate {
    function baseRatePerBlock() external view returns (uint256);
    function slope1PerBlock() external view returns (uint256);
    function slope2PerBlock() external view returns (uint256);
    function kink() external view returns (uint256);
    function blocksPerYear() external view returns (uint256);
}

interface IFixedRate {
    function borrowRatePerBlock() external view returns (uint256);
}

/// @notice Supply, borrow, interest accrual, repay, and redeem on the forked comptroller.
contract LendingForkTest is ForkBase {
    function test_fork_marketConfigAtPinnedBlock() public view {
        IComptroller unit = IComptroller(COMPTROLLER);
        assertEq(unit.getImplementation(), COMPTROLLER_IMPL);
        assertEq(unit.oracle(), ORACLE);
        assertEq(unit.closeFactorMantissa(), 0.5e18);
        assertEq(unit.liquidationIncentiveMantissa(), 1.1e18);
        assertFalse(unit.borrowPaused());
        assertFalse(unit.redeemPaused());
        assertFalse(unit.liquidatePaused());

        assertEq(unit.allMarkets(0), C_ASTR);
        assertEq(unit.allMarkets(1), C_USDSC);
        assertEq(unit.allMarkets(2), C_USDC);
        assertEq(unit.allMarkets(3), C_SVUSD);
        (bool extraOk,) = COMPTROLLER.staticcall(abi.encodeWithSignature("allMarkets(uint256)", uint256(4)));
        assertFalse(extraOk);
        (bool legacyOk,) = COMPTROLLER.staticcall(abi.encodeWithSignature("getAllMarkets()"));
        assertFalse(legacyOk);

        _assertFactors(C_ASTR, 0.30e18, 0.35e18);
        _assertFactors(C_USDSC, 0.80e18, 0.85e18);
        _assertFactors(C_USDC, 0.80e18, 0.85e18);
        _assertFactors(C_SVUSD, 0, 0);

        assertEq(ICToken(C_ASTR).interestRateModel(), JUMP_IRM);
        assertEq(ICToken(C_USDSC).interestRateModel(), JUMP_IRM);
        assertEq(ICToken(C_USDC).interestRateModel(), JUMP_IRM);
        assertEq(ICToken(C_SVUSD).interestRateModel(), FIXED_IRM);
        assertEq(ICToken(C_ASTR).underlying(), ICToken(C_ASTR).underlyingAddress());
        assertEq(IERC20(ICToken(C_USDC).underlying()).symbol(), "USDC.e");

        IJumpRate jump = IJumpRate(JUMP_IRM);
        assertEq(jump.blocksPerYear(), 15_768_000);
        assertEq(jump.kink(), 0.9e18);
        assertGt(jump.baseRatePerBlock(), 0);
        assertGt(jump.slope1PerBlock(), 0);
        assertGt(jump.slope2PerBlock(), 0);
        assertGt(IFixedRate(FIXED_IRM).borrowRatePerBlock(), 0);

        assertGt(IVibePriceOracle(ORACLE).getUnderlyingPrice(C_ASTR), 0);
        assertGt(IVibePriceOracle(ORACLE).getUnderlyingPrice(C_USDC), 0);
        assertEq(IVibePriceOracle(ORACLE).getUnderlyingPrice(C_SVUSD), 1e18);
        assertEq(IVibePriceOracle(ORACLE).getUnderlyingPrice(C_USDSC), 1e18);

        // cTokens are ordinary contracts, not Unitroller-style proxies.
        (bool implOk,) = C_ASTR.staticcall(abi.encodeWithSignature("getImplementation()"));
        assertFalse(implOk);
        assertGt(C_ASTR.code.length, 1000);
        assertGt(C_USDC.code.length, 1000);
        assertGt(C_SVUSD.code.length, 1000);
    }

    function test_fork_supplyEnterBorrowAccrueRepayRedeem() public {
        IComptroller unit = IComptroller(COMPTROLLER);
        assertFalse(unit.mintPaused(C_USDC));
        assertFalse(unit.borrowPaused());
        assertFalse(unit.borrowPausedMarket(C_ASTR));
        assertFalse(unit.marketFrozen(C_USDC));
        assertFalse(unit.marketFrozen(C_ASTR));

        address user = makeAddr("supplier");
        address usdc = ICToken(C_USDC).underlying();
        address astr = ICToken(C_ASTR).underlying();
        uint256 supplied = 1_000_000_000; // 1,000 USDC.e

        deal(usdc, user, supplied);
        vm.startPrank(user);
        _approve(usdc, C_USDC, supplied);
        ICToken(C_USDC).mint(supplied);
        assertEq(IERC20(usdc).balanceOf(user), 0);
        assertGt(ICToken(C_USDC).balanceOf(user), 0);

        // Membership is required on the borrowed market, not only on the collateral.
        address[] memory markets = new address[](2);
        markets[0] = C_USDC;
        markets[1] = C_ASTR;
        unit.enterMarkets(markets);
        assertTrue(unit.accountMembership(user, C_USDC));
        assertTrue(unit.accountMembership(user, C_ASTR));

        uint256 borrowAmount = 10 ether;
        assertGt(ICToken(C_ASTR).internalCash(), borrowAmount);
        ICToken(C_ASTR).borrow(borrowAmount);
        assertEq(IERC20(astr).balanceOf(user), borrowAmount);
        vm.stopPrank();

        uint256 debtBefore = ICToken(C_ASTR).borrowBalance(user);
        uint256 indexBefore = ICToken(C_ASTR).borrowIndex();
        assertEq(debtBefore, borrowAmount);

        // Accrual is per block.number. Moving timestamp alone does not accrue.
        // Restore the fork timestamp afterwards. A year-long warp makes the
        // Chainlink feeds older than maxStalenessDefault (1 day), getUnderlyingPrice
        // returns 0 for ASTR and USDC.e, and redeem reverts CollateralInsufficient.
        uint256 startTime = block.timestamp;
        vm.warp(startTime + 365 days);
        ICToken(C_ASTR).accrueInterest();
        assertEq(ICToken(C_ASTR).borrowBalance(user), debtBefore);
        assertEq(ICToken(C_ASTR).borrowIndex(), indexBefore);
        vm.warp(startTime);
        assertEq(block.timestamp, startTime);

        vm.roll(block.number + 1_000_000);
        assertEq(block.timestamp, startTime, "roll moved timestamp");
        ICToken(C_ASTR).accrueInterest();
        uint256 debtAfter = ICToken(C_ASTR).borrowBalance(user);
        assertGt(debtAfter, debtBefore);
        assertGt(ICToken(C_ASTR).borrowIndex(), indexBefore);

        deal(astr, user, debtAfter);
        vm.startPrank(user);
        _approve(astr, C_ASTR, debtAfter);
        ICToken(C_ASTR).repay(debtAfter);
        assertEq(ICToken(C_ASTR).borrowBalance(user), 0);

        uint256 cBalance = ICToken(C_USDC).balanceOf(user);
        ICToken(C_USDC).redeem(cBalance);
        vm.stopPrank();

        assertEq(ICToken(C_USDC).balanceOf(user), 0);
        assertEq(IERC20(usdc).balanceOf(user), supplied);
    }

    function _assertFactors(address cToken, uint256 cf, uint256 lt) internal view {
        IComptroller unit = IComptroller(COMPTROLLER);
        assertTrue(unit.markets(cToken));
        assertEq(unit.marketCollateralFactorMantissa(cToken), cf);
        assertEq(unit.marketLiquidationThresholdMantissa(cToken), lt);
    }
}
