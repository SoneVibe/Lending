// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ForkBase, ICToken, IComptroller, IERC20, IVibePriceOracle, LiquidityData} from "./ForkBase.sol";

/// @notice Shortfall is created by mocking the oracle price of the collateral cToken.
///         No prices are written on chain.
contract LiquidationForkTest is ForkBase {
    function test_fork_liquidationSeizesCollateralWithinCloseFactor() public {
        address borrower = makeAddr("borrower");
        address liquidator = makeAddr("liquidator");

        _openPosition(borrower);

        address astr = ICToken(C_ASTR).underlying();
        uint256 debt = ICToken(C_ASTR).borrowBalance(borrower);
        assertGt(debt, 0);

        deal(astr, liquidator, 1_000 ether);
        vm.startPrank(liquidator);
        _approve(astr, C_ASTR, type(uint256).max);

        // Healthy account: seize is refused. The repayment is rolled back with it.
        vm.expectRevert(bytes4(keccak256("CollateralInsufficient()")));
        ICToken(C_ASTR).liquidateBorrow(borrower, debt, C_USDC);
        vm.stopPrank();
        assertEq(ICToken(C_ASTR).borrowBalance(borrower), debt);

        uint256 price = _collateralPriceCausingShortfall(borrower, debt);
        vm.mockCall(
            ORACLE,
            abi.encodeWithSelector(IVibePriceOracle.getUnderlyingPrice.selector, C_USDC),
            abi.encode(price)
        );

        LiquidityData memory ld = IComptroller(COMPTROLLER).getAccountLiquidity(borrower);
        assertGt(ld.borrowUSD, ld.liquidationUSD, "mocked price did not create a shortfall");

        uint256 closeFactor = IComptroller(COMPTROLLER).closeFactorMantissa();
        // Same ceiling the cToken uses: (debt * cf + 1e18 - 1) / 1e18.
        uint256 maxRepay = (debt * closeFactor + 1e18 - 1) / 1e18;
        assertLt(maxRepay, debt, "close factor leaves debt");
        assertApproxEqAbs(maxRepay, debt / 2, 1);

        uint256 expectedSeize = ICToken(C_ASTR).previewSeizeTokens(C_USDC, maxRepay);
        assertGt(expectedSeize, 0);
        assertLt(expectedSeize, ICToken(C_USDC).balanceOf(borrower));

        uint256 astrBefore = IERC20(astr).balanceOf(liquidator);
        uint256 liquidatorCBefore = ICToken(C_USDC).balanceOf(liquidator);
        uint256 borrowerCBefore = ICToken(C_USDC).balanceOf(borrower);

        // Repay request is the full debt. The market must cap it at the close factor.
        vm.prank(liquidator);
        ICToken(C_ASTR).liquidateBorrow(borrower, debt, C_USDC);

        assertEq(astrBefore - IERC20(astr).balanceOf(liquidator), maxRepay, "spent above close factor");
        assertEq(ICToken(C_USDC).balanceOf(liquidator) - liquidatorCBefore, expectedSeize, "seized cTokens");
        assertEq(borrowerCBefore - ICToken(C_USDC).balanceOf(borrower), expectedSeize, "borrower cTokens");
        uint256 debtLeft = ICToken(C_ASTR).borrowBalance(borrower);
        assertEq(debtLeft, debt - maxRepay);
        assertGt(debtLeft, 0);
    }

    function _openPosition(address borrower) internal {
        address usdc = ICToken(C_USDC).underlying();
        uint256 supplied = 10_000_000_000; // 10,000 USDC.e
        uint256 borrowAmount = 50 ether; // 50 ASTR, well inside cASTR cash

        deal(usdc, borrower, supplied);
        vm.startPrank(borrower);
        _approve(usdc, C_USDC, supplied);
        ICToken(C_USDC).mint(supplied);

        address[] memory markets = new address[](2);
        markets[0] = C_USDC;
        markets[1] = C_ASTR;
        IComptroller(COMPTROLLER).enterMarkets(markets);
        ICToken(C_ASTR).borrow(borrowAmount);
        vm.stopPrank();
    }

    /// @dev Pick a collateral price low enough that liquidation USD < borrow USD,
    ///      and high enough that the close-factor seize fits in the supplied cTokens.
    function _collateralPriceCausingShortfall(address borrower, uint256 debt) internal view returns (uint256) {
        uint256 cBal = ICToken(C_USDC).balanceOf(borrower);
        uint256 exRate = ICToken(C_USDC).exchangeRateStored();
        uint256 supplyNorm = cBal * exRate / 1e18;
        uint256 lt = IComptroller(COMPTROLLER).marketLiquidationThresholdMantissa(C_USDC);
        uint256 astrPrice = IVibePriceOracle(ORACLE).getUnderlyingPrice(C_ASTR);
        uint256 borrowUSD = debt * astrPrice / 1e18;

        uint256 maxRepay = (debt * IComptroller(COMPTROLLER).closeFactorMantissa() + 1e18 - 1) / 1e18;
        uint256 seizeUSD = maxRepay * astrPrice / 1e18 * IComptroller(COMPTROLLER).liquidationIncentiveMantissa() / 1e18;
        uint256 priceCeil = borrowUSD * 1e36 / (supplyNorm * lt);
        return _searchPrice(supplyNorm, lt, borrowUSD, seizeUSD, exRate, cBal, priceCeil);
    }

    function _searchPrice(
        uint256 supplyNorm,
        uint256 lt,
        uint256 borrowUSD,
        uint256 seizeUSD,
        uint256 exRate,
        uint256 cBal,
        uint256 priceCeil
    ) internal pure returns (uint256) {
        uint256 step = priceCeil / 40;
        if (step == 0) step = 1;
        uint256 price = priceCeil - 1;
        while (price > 0) {
            if (_priceWorks(supplyNorm, lt, borrowUSD, seizeUSD, exRate, cBal, price)) return price;
            if (price <= step) break;
            price -= step;
        }
        revert("no collateral price keeps seize inside the position");
    }

    function _priceWorks(
        uint256 supplyNorm,
        uint256 lt,
        uint256 borrowUSD,
        uint256 seizeUSD,
        uint256 exRate,
        uint256 cBal,
        uint256 price
    ) internal pure returns (bool) {
        uint256 liqUSD = supplyNorm * price / 1e18 * lt / 1e18;
        if (liqUSD >= borrowUSD) return false;
        // USDC.e has 6 decimals. Seize underlying is scaled back up to 18 before the exchange rate.
        uint256 seizeRaw = seizeUSD * 1e6 / price;
        uint256 seizeCTokens = seizeRaw * 1e12 * 1e18 / exRate;
        return seizeCTokens > 0 && seizeCTokens < cBal;
    }
}
