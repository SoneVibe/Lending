// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../interfaces/IV_MasterEnhanced.sol";
import "../interfaces/IVibePriceOracle.sol";
import "../libraries/SafeTransferLib.sol";
import "./SVUSD.sol";

interface IInterestRateModel {
    function getBorrowRate(uint cash, uint borrows, uint reserves) external view returns (uint);
    function isInterestRateModel() external pure returns (bool);
}

/// @title V_cSVUSD_Mintable
/// @notice A specialized market that Mints/Burns SVUSD instead of lending existing tokens.
/// @dev Acts as a "Facilitator" in the SVUSD contract.
contract V_cSVUSD_Mintable {
    // ======================================================
    // Identity
    // ======================================================
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    
    SVUSD public immutable underlyingToken; // The SVUSD token
    IV_MasterEnhanced public immutable comptroller;
    address public guardian;

    // ======================================================
    // Debt Storage
    // ======================================================
    // Note: supply logic is minimal here as we don't really have suppliers, 
    // but we keep the structure for compatibility if someone sends SVUSD here.
    mapping(address => uint256) public balanceOf; 
    uint256 public totalSupply;

    uint256 public accrualBlockNumber;
    uint256 public borrowIndex;          // 1e18 initial
    uint256 public totalBorrows;         // Total SVUSD debt in existence
    uint256 public totalReserves;        // Accumulated interest (revenue)
    
    // In GHO model, reserve factor is effectively 100% (protocol revenue),
    // but we keep the variable to be compatible with IRM interface.
    uint256 public constant reserveFactorMantissa = 1e18; // 100% to reserves/treasury

    IInterestRateModel public interestRateModel;

    mapping(address => uint256) public borrowPrincipal;
    mapping(address => uint256) public accountBorrowIndex;

    // Reentrancy
    uint8 private _status;
    uint8 private constant _NOT_ENTERED = 1;
    uint8 private constant _ENTERED = 2;

    // ======================================================
    // Events
    // ======================================================
    event AccrueInterest(uint256 interestAccumulated, uint256 borrowIndexNew, uint256 totalBorrowsNew, uint256 totalReservesNew);
    event Borrow(address indexed borrower, uint256 amount);
    event Repay(address indexed payer, address indexed borrower, uint256 amount);
    event LiquidateBorrow(address indexed liquidator, address indexed borrower, uint256 repayAmount, address cTokenCollateral, uint256 seizeTokens);
    event NewInterestRateModel(address oldModel, address newModel);
    event TreasurySweep(address to, uint256 amount);

    // ======================================================
    // Errors
    // ======================================================
    error Reentrancy();
    error NotGuardian();
    error BorrowZero();
    error RepayZero();
    error NoDebt();
    error BorrowNotAllowed();
    error BorrowCapExceeded();
    error RateTooHigh();
    error LiquidateSelf();
    error SeizeNotAllowed();
    error InsufficientCollateral();

    modifier nonReentrant() {
        if (_status == _ENTERED) revert Reentrancy();
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    constructor(
        string memory _n,
        string memory _s,
        address _svusd,
        address _comptroller,
        address _guardian,
        address _irm
    ) {
        name = _n;
        symbol = _s;
        underlyingToken = SVUSD(_svusd);
        comptroller = IV_MasterEnhanced(_comptroller);
        guardian = _guardian;
        interestRateModel = IInterestRateModel(_irm);
        
        borrowIndex = 1e18;
        accrualBlockNumber = block.number;
        _status = _NOT_ENTERED;
    }

    // ======================================================
    // Compatibility / View
    // ======================================================
    function underlying() external view returns (address) { return address(underlyingToken); }
    function underlyingAddress() external view returns (address) { return address(underlyingToken); }
    function underlyingDecimals() external pure returns (uint8) { return 18; }
    
    // Exchange rate is strictly 1:1 for the debt token calculation usually.
    // Changed to pure to fix mutability warning since it returns a constant.
    function exchangeRateStored() public pure returns (uint256) {
        return 1e18; 
    }
    
    // Changed to pure to fix mutability warning.
    function exchangeRateCurrent() external pure returns (uint256) {
        return 1e18;
    }

    // ======================================================
    // Admin
    // ======================================================
    function setInterestRateModel(address newModel) external onlyGuardian {
        accrueInterest();
        interestRateModel = IInterestRateModel(newModel);
        emit NewInterestRateModel(address(interestRateModel), newModel);
    }
    
    /// @notice Sweeps interest revenue (SVUSD) to the treasury.
    /// @dev Since reserves are theoretical here (SVUSD is minted/burned), 
    /// sweeping actually means MINTING the accrued interest amount to the treasury.
    function sweepReserves(address to, uint256 amount) external onlyGuardian {
        accrueInterest();
        if (amount > totalReserves) amount = totalReserves;
        totalReserves -= amount;
        
        // Mint the revenue to the DAO/Treasury
        underlyingToken.mint(to, amount);
        emit TreasurySweep(to, amount);
    }

    // ======================================================
    // Interest Accrual
    // ======================================================
    function accrueInterest() public {
        uint256 currentBlock = block.number;
        uint256 delta = currentBlock - accrualBlockNumber;
        if (delta == 0) return;

        uint256 borrows = totalBorrows;
        // Cash is effectively infinite/irrelevant for rate calculation in GHO style.
        // We pass 0 cash, borrows, totalReserves to model.
        
        uint256 borrowRate = interestRateModel.getBorrowRate(0, borrows, totalReserves);
        if (borrowRate > 5e13) revert RateTooHigh();

        uint256 interestAccumulated = (borrowRate * delta * borrows) / 1e18;
        uint256 totalBorrowsNew = borrows + interestAccumulated;
        uint256 totalReservesNew = totalReserves + interestAccumulated; // 100% to protocol
        uint256 borrowIndexNew = borrowIndex + ((borrowRate * delta * borrowIndex) / 1e18);

        totalBorrows = totalBorrowsNew;
        totalReserves = totalReservesNew;
        borrowIndex = borrowIndexNew;
        accrualBlockNumber = currentBlock;

        emit AccrueInterest(interestAccumulated, borrowIndexNew, totalBorrowsNew, totalReservesNew);
        
        // Vibe Rewards hook
        try comptroller.updateMarketRewards(address(this)) {} catch {}
    }

    // ======================================================
    // User Debt
    // ======================================================
    function borrowBalance(address account) external view returns (uint256) {
        return _currentBorrowBalance(account);
    }

    function _currentBorrowBalance(address account) internal view returns (uint256) {
        uint256 p = borrowPrincipal[account];
        if (p == 0) return 0;
        uint256 idx = accountBorrowIndex[account];
        if (idx == 0) return 0;
        return (p * borrowIndex) / idx;
    }

    // ======================================================
    // Actions: BORROW (MINT)
    // ======================================================
    function borrow(uint256 amount) external nonReentrant {
        accrueInterest();
        if (amount == 0) revert BorrowZero();
        if (!comptroller.canBorrow(msg.sender, address(this), amount)) revert BorrowNotAllowed();
        
        uint256 bCap = comptroller.marketBorrowCaps(address(this));
        if (bCap != 0 && totalBorrows + amount > bCap) revert BorrowCapExceeded();

        // Calculate new debt
        uint256 prevBorrow = _currentBorrowBalance(msg.sender);
        uint256 newBorrow = prevBorrow + amount;
        
        // [FIXED] Guarda Principal NOMINAL
        borrowPrincipal[msg.sender] = newBorrow;
        accountBorrowIndex[msg.sender] = borrowIndex;
        
        totalBorrows += amount;

        // MINT SVUSD to user
        underlyingToken.mint(msg.sender, amount);
        
        emit Borrow(msg.sender, amount);
        
        try comptroller.distributeBorrower(msg.sender, address(this), newBorrow) {} catch {}
    }

    // ======================================================
    // Actions: REPAY (BURN)
    // ======================================================
    function repay(uint256 amount) external nonReentrant {
        accrueInterest();
        if (amount == 0) revert RepayZero();
        
        uint256 userBorrow = _currentBorrowBalance(msg.sender);
        if (userBorrow == 0) revert NoDebt();
        
        uint256 repayFinal = amount >= userBorrow ? userBorrow : amount;

        // Pull tokens from user
        SafeTransferLib.safeTransferFrom(address(underlyingToken), msg.sender, address(this), repayFinal);
        
        // BURN tokens immediately
        underlyingToken.burn(address(this), repayFinal);

        // Update accounting
        uint256 newBorrow = userBorrow - repayFinal;
        if (newBorrow == 0) {
            borrowPrincipal[msg.sender] = 0;
            accountBorrowIndex[msg.sender] = borrowIndex;
        } else {
            // [FIXED] Guarda Principal NOMINAL
            borrowPrincipal[msg.sender] = newBorrow;
            accountBorrowIndex[msg.sender] = borrowIndex;
        }

        if (totalBorrows >= repayFinal) {
            totalBorrows -= repayFinal;
        } else {
            totalBorrows = 0;
        }

        emit Repay(msg.sender, msg.sender, repayFinal);
        try comptroller.distributeBorrower(msg.sender, address(this), newBorrow) {} catch {}
    }

    // ======================================================
    // Actions: LIQUIDATE (BURN)
    // ======================================================
    function liquidateBorrow(address borrower, uint256 repayAmount, address cTokenCollateral) external nonReentrant {
        accrueInterest();
        
        // [FIXED] Actualiza el interés del colateral si es diferente a este mercado
        // para asegurar que el exchangeRateStored usado en el calculo de seize sea fresco.
        if (cTokenCollateral != address(this)) {
            IV_cTokenExtended(cTokenCollateral).accrueInterest();
        }

        if (borrower == msg.sender) revert LiquidateSelf();

        uint256 borrowerDebt = _currentBorrowBalance(borrower);
        if (borrowerDebt == 0) revert NoDebt();

        // Calculate max close
        uint256 cf = comptroller.closeFactorMantissa();
        uint256 maxRepay = (borrowerDebt * cf) / 1e18;
        uint256 actualRepay = repayAmount;
        if (actualRepay > maxRepay) actualRepay = maxRepay;
        if (actualRepay > borrowerDebt) actualRepay = borrowerDebt; // Safety

        // 1. Pull SVUSD from liquidator
        SafeTransferLib.safeTransferFrom(address(underlyingToken), msg.sender, address(this), actualRepay);

        // 2. Burn SVUSD
        underlyingToken.burn(address(this), actualRepay);

        // 3. Seize Collateral
        uint256 seizeTokens;
        if (cTokenCollateral != address(this)) {
            seizeTokens = _liquidateCalculateSeizeTokens(cTokenCollateral, actualRepay);
            IV_cTokenExtended(cTokenCollateral).seize(msg.sender, borrower, seizeTokens);
        } else {
             // Self-liquidation (SVUSD collateral? Rare but possible if SVUSD is supplied back)
             revert("SVUSD cannot be collateral");
        }

        // 4. Update Debt
        uint256 newBorrow = borrowerDebt - actualRepay;
        if (newBorrow == 0) {
            borrowPrincipal[borrower] = 0;
            accountBorrowIndex[borrower] = borrowIndex;
        } else {
            // [FIXED] Guarda Principal NOMINAL
            borrowPrincipal[borrower] = newBorrow;
            accountBorrowIndex[borrower] = borrowIndex;
        }
        
        if (totalBorrows >= actualRepay) {
            totalBorrows -= actualRepay;
        } else {
            totalBorrows = 0;
        }

        emit LiquidateBorrow(msg.sender, borrower, actualRepay, cTokenCollateral, seizeTokens);
        try comptroller.distributeBorrower(borrower, address(this), newBorrow) {} catch {}
    }

    // Required by cToken interface for other markets to call seize on THIS market
    // But SVUSD shouldn't really be used as collateral.
    // FIX: Commented out parameters to silence unused variable warnings
    function seize(address /*liquidator*/, address /*borrower*/, uint256 /*seizeTokens*/) external pure {
        revert SeizeNotAllowed();
    }

    // Helper to calculate seize amount
    function _liquidateCalculateSeizeTokens(address cTokenCollateral, uint256 actualRepayAmount) internal view returns (uint256) {
        // Price of Borrowed (SVUSD) is typically $1 or Oracle
        // Price of Collateral
        // Liquidation Incentive
        
        // This requires access to Oracle via Comptroller
        IVibePriceOracle oracle = IVibePriceOracle(comptroller.oracle());
        
        uint256 priceBorrowed = oracle.getUnderlyingPrice(address(this)); // Price of SVUSD
        uint256 priceCollateral = oracle.getUnderlyingPrice(cTokenCollateral);
        uint256 incentive = comptroller.liquidationIncentiveMantissa();
        
        // Value in USD (scaled)
        // Note: Oracle usually returns scaled by (36 - decimals).
        // SVUSD is 18 decimals.
        uint256 valueBorrowed = (actualRepayAmount * priceBorrowed) / 1e18; 
        
        // Incentive
        uint256 valueToSeize = (valueBorrowed * incentive) / 1e18;
        
        // Tokens to seize = ValueToSeize / PriceCollateral
        // But we need to account for exchangeRate of collateral to get cTokens
        
        uint256 amountUnderlyingCollateral = (valueToSeize * 1e18) / priceCollateral;
        
        // Convert underlying to cTokens
        uint256 exRate = IV_cTokenExtended(cTokenCollateral).exchangeRateStored();
        return (amountUnderlyingCollateral * 1e18) / exRate;
    }
}

// [FIXED] Added accrueInterest to interface
interface IV_cTokenExtended {
    function seize(address liquidator, address borrower, uint256 seizeTokens) external;
    function exchangeRateStored() external view returns (uint256);
    function accrueInterest() external;
}