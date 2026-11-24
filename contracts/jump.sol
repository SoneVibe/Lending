// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Interfaz mínima que usa el cToken
interface IInterestRateModel {
    function isInterestRateModel() external pure returns (bool);
    function getBorrowRate(uint cash, uint borrows, uint reserves) external view returns (uint);
    function getSupplyRate(uint cash, uint borrows, uint reserves, uint reserveFactorMantissa) external view returns (uint);
}

/// @title Safe Jump Rate Model (overflow-resistant)
/// @dev Designed for use on L2 with many blocks/year or arbitrary per-block params.
/// Uses fixed-point 1e18 mantissa everywhere.
contract JumpRateModelSafe is IInterestRateModel {
    uint256 public immutable baseRatePerBlock;   // mantissa per-block (1e18)
    uint256 public immutable slope1PerBlock;     // mantissa per-block (1e18)
    uint256 public immutable slope2PerBlock;     // mantissa per-block (1e18)
    uint256 public immutable kink;               // mantissa (1e18)
    uint256 public immutable blocksPerYear;      // 0 => parameters are already per-block

    // Safety: maximum allowed borrowRatePerBlock (default ~5e13 in old code). We keep configurable.
    uint256 public immutable maxBorrowRatePerBlock;

    constructor(
        uint256 _base,            // annual (1e18) if _blocksPerYear>0 else per-block (1e18)
        uint256 _slope1,          // same units as _base
        uint256 _slope2,          // same units
        uint256 _kink,            // 1e18 fixed-point
        uint256 _blocksPerYear,   // blocks per year (set to 15768000 for ~2s blocks)
        uint256 _maxBorrowRatePerBlock // safety cap in mantissa per-block (e.g. 5e13)
    ) {
        require(_kink <= 1e18, "kink>1e18");
        require(_blocksPerYear < 100_000_000, "blocksPerYear too large");

        kink = _kink;
        blocksPerYear = _blocksPerYear;

        if (_blocksPerYear > 0) {
            // Convert annual inputs to per-block by integer division.
            baseRatePerBlock = _base / _blocksPerYear;
            slope1PerBlock   = _slope1 / _blocksPerYear;
            slope2PerBlock   = _slope2 / _blocksPerYear;
        } else {
            baseRatePerBlock = _base;
            slope1PerBlock   = _slope1;
            slope2PerBlock   = _slope2;
        }

        // store max allowed (provided by deployer) for a final safety check
        maxBorrowRatePerBlock = _maxBorrowRatePerBlock;

        // Basic sanity: ensure computed theoretical max does not exceed cap
        // compute maxBorrowRate = base + kink*slope1/1e18 + (1e18-kink)*slope2/1e18
        uint256 term1 = baseRatePerBlock;

        // use mulDivFixedPoint to avoid intermediate overflow when computing kink*slope1/1e18 etc.
        uint256 term2 = mulDivFixedPoint(kink, slope1PerBlock); // (kink * slope1PerBlock) / 1e18
        uint256 term3 = mulDivFixedPoint((1e18 - kink), slope2PerBlock); // ((1-kink)*slope2)/1e18

        uint256 maxBorrowRateComputed = term1 + term2 + term3;
        require(maxBorrowRateComputed <= _maxBorrowRatePerBlock, "maxBorrowRate too high");
    }

    /// @notice Simple marker
    function isInterestRateModel() external pure override returns (bool) {
        return true;
    }

    /// @dev utilization = borrows / (cash + borrows - reserves)
    /// returns 0..1e18
    function _utilization(uint256 cash, uint256 borrows, uint256 reserves) internal pure returns (uint256) {
        if (borrows == 0) return 0;
        uint256 denom = cash + borrows;
        if (denom <= reserves) return 0; // avoid division by zero or negative behavior
        // safe multiplication: borrows * 1e18 / (denom - reserves)
        unchecked {
            return (borrows * 1e18) / (denom - reserves);
        }
    }

    /// @notice Compute borrow rate per block (mantissa)
    function getBorrowRate(uint256 cash, uint256 borrows, uint256 reserves) public view override returns (uint256) {
        uint256 u = _utilization(cash, borrows, reserves); // 0..1e18

        // If u <= kink: base + u * slope1 / 1e18
        if (u <= kink) {
            uint256 extra = mulDivFixedPoint(u, slope1PerBlock);
            uint256 r = baseRatePerBlock + extra;
            if (r > maxBorrowRatePerBlock) revert("RateTooHigh");
            return r;
        }

        // else: base + kink*slope1/1e18 + (u - kink)*slope2 / 1e18
        uint256 first = baseRatePerBlock;
        uint256 second = mulDivFixedPoint(kink, slope1PerBlock); // (kink*slope1)/1e18
        uint256 excess = u - kink; // safe: u > kink
        uint256 third = mulDivFixedPoint(excess, slope2PerBlock); // (excess*slope2)/1e18

        uint256 rtotal = first + second + third;
        if (rtotal > maxBorrowRatePerBlock) revert("RateTooHigh");
        return rtotal;
    }

    /// @notice Supply rate per block given reserve factor (mantissa)
    function getSupplyRate(uint256 cash, uint256 borrows, uint256 reserves, uint256 reserveFactorMantissa) external view override returns (uint256) {
        if (borrows == 0) return 0;
        uint256 borrowRate = getBorrowRate(cash, borrows, reserves);
        uint256 u = _utilization(cash, borrows, reserves);
        uint256 br_times_u = mulDivFixedPoint(borrowRate, u); // (borrowRate * u) / 1e18
        uint256 oneMinusReserve = 1e18 - reserveFactorMantissa;
        uint256 supplyRate = mulDivFixedPoint(br_times_u, oneMinusReserve); // (br_times_u * oneMinusReserve)/1e18
        return supplyRate;
    }

    // ============================
    // Helper: fixed-point multiply with overflow-avoidance
    // computes (a * b) / 1e18 safely
    function mulDivFixedPoint(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 FIXED_ONE = 1e18;
        if (a == 0 || b == 0) return 0;
        unchecked {
            if (a <= type(uint256).max / b) {
                return (a * b) / FIXED_ONE;
            }
        }

        uint256 q = a / FIXED_ONE;
        uint256 r = a % FIXED_ONE;

        uint256 part1 = q * b;
        uint256 part2 = (r * b) / FIXED_ONE;

        unchecked {
            return part1 + part2;
        }
    }
}