// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../libraries/SafeTransferLib.sol";
import "./SVUSD.sol";

interface IERC20Basic {
    function balanceOf(address account) external view returns (uint256);
}

/// @title SVUSD Stability Module (HSM/PSM)
/// @notice Supports the peg by allowing swaps between SVUSD and a reserve asset (USDC).
contract SVUSD_StabilityModule {
    SVUSD public immutable svusd;
    address public immutable reserveAsset; // e.g. USDC
    uint256 public immutable reserveDecimals;

    address public admin;
    address public treasury;

    // Fees (basis points, 10000 = 100%)
    uint256 public feeIn;  // Fee when buying SVUSD (depositing USDC)
    uint256 public feeOut; // Fee when selling SVUSD (withdrawing USDC)

    uint256 public reserveCap; // Max USDC allowed in contract

    bool public paused;

    // Reentrancy Guard Manual
    uint8 private _status;
    uint8 private constant _NOT_ENTERED = 1;
    uint8 private constant _ENTERED = 2;

    event SwapIn(address indexed user, uint256 amountIn, uint256 amountOut, uint256 fee);
    event SwapOut(address indexed user, uint256 amountIn, uint256 amountOut, uint256 fee);
    event FeesUpdated(uint256 feeIn, uint256 feeOut);
    event ParamsUpdated(address treasury, uint256 cap);
    event PausedUpdated(bool status);

    error Paused();
    error CapExceeded();
    error TransferFailed();
    error Unauthorized();
    error Reentrancy();
    
    constructor(
        address _svusd,
        address _reserve,
        uint256 _reserveDecimals,
        address _treasury
    ) {
        svusd = SVUSD(_svusd);
        reserveAsset = _reserve;
        reserveDecimals = _reserveDecimals;
        treasury = _treasury;
        admin = msg.sender;
        
        // Default fees: 0.1%
        feeIn = 10; 
        feeOut = 10;
        reserveCap = 1_000_000 * (10 ** _reserveDecimals); // 1M init cap
        _status = _NOT_ENTERED;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (_status == _ENTERED) revert Reentrancy();
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    // ======================================================
    // Users: BUY SVUSD (Deposit USDC)
    // ======================================================
    function buySVUSD(uint256 amountUSDC) external nonReentrant {
        if (paused) revert Paused();
        
        // 1. Calculate SVUSD amount
        uint256 svusdAmount = _normalize(amountUSDC);
        
        // 2. Calculate Fee
        uint256 feeAmt = (svusdAmount * feeIn) / 10000;
        uint256 netMint = svusdAmount - feeAmt;

        // 3. Check Cap (FIX: Usando IERC20 directo, no SafeTransferLib para lectura)
        uint256 currentReserves = IERC20Basic(reserveAsset).balanceOf(address(this));
        if (currentReserves + amountUSDC > reserveCap) revert CapExceeded();

        // 4. Transfer USDC in (Usando SafeTransferLib para escritura)
        SafeTransferLib.safeTransferFrom(reserveAsset, msg.sender, address(this), amountUSDC);

        // 5. Mint SVUSD to user
        svusd.mint(msg.sender, netMint);
        
        // 6. Mint Fee to Treasury
        if (feeAmt > 0) {
            svusd.mint(treasury, feeAmt);
        }

        emit SwapIn(msg.sender, amountUSDC, netMint, feeAmt);
    }

    // ======================================================
    // Users: SELL SVUSD (Redeem USDC)
    // ======================================================
    function sellSVUSD(uint256 amountSVUSD) external nonReentrant {
        if (paused) revert Paused();

        // 1. Burn SVUSD
        svusd.burn(msg.sender, amountSVUSD);

        // 2. Calculate USDC out
        uint256 grossUSDC = _denormalize(amountSVUSD);
        
        // 3. Fee
        uint256 feeValUSDC = (grossUSDC * feeOut) / 10000;
        uint256 netUSDC = grossUSDC - feeValUSDC;

        // 4. Transfer USDC out
        SafeTransferLib.safeTransfer(reserveAsset, msg.sender, netUSDC);
        
        // 5. Send fee to treasury
        if (feeValUSDC > 0) {
            SafeTransferLib.safeTransfer(reserveAsset, treasury, feeValUSDC);
        }

        emit SwapOut(msg.sender, amountSVUSD, netUSDC, feeValUSDC);
    }

    // ======================================================
    // Helpers
    // ======================================================
    function _normalize(uint256 amountRes) internal view returns (uint256) {
        if (reserveDecimals == 18) return amountRes;
        return amountRes * (10 ** (18 - reserveDecimals));
    }
    
    function _denormalize(uint256 amount18) internal view returns (uint256) {
        if (reserveDecimals == 18) return amount18;
        return amount18 / (10 ** (18 - reserveDecimals));
    }

    // ======================================================
    // Admin
    // ======================================================
    function setFees(uint256 _in, uint256 _out) external onlyAdmin {
        require(_in <= 500 && _out <= 500, "Max fee 5%");
        feeIn = _in;
        feeOut = _out;
        emit FeesUpdated(_in, _out);
    }

    function setParams(address _treasury, uint256 _cap) external onlyAdmin {
        treasury = _treasury;
        reserveCap = _cap;
        emit ParamsUpdated(_treasury, _cap);
    }
    
    function setPaused(bool _p) external onlyAdmin {
        paused = _p;
        emit PausedUpdated(_p);
    }

    /// @notice In case of emergency or upgrade, sweep assets
    function sweep(address token, uint256 amount) external onlyAdmin {
        SafeTransferLib.safeTransfer(token, treasury, amount);
    }
}