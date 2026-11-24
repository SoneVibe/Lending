// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/*
 * ============================================================================
 *  SONEVIBE DEX — CORE (Factory + Pair + LP Token)
 * ============================================================================
 *  Integration summary for developers, aggregators, bots and AI agents:
 *
 *  MODEL        Constant-product AMM (x * y = k), Uniswap V2 architecture.
 *  SWAP FEE     0.25% per hop (vs 0.30% on Uniswap V2). 100% to LPs when
 *               `feeTo == address(0)`; otherwise 1/6 of fee growth is minted
 *               to `feeTo` as LP tokens (same mechanism as Uniswap V2).
 *  CUSTODY      Non-custodial. Pair contracts have NO owner, NO admin
 *               withdrawal, NO pause and NO upgradeability. Only LP token
 *               holders can withdraw liquidity, via `burn`.
 *  COMPAT       Pair ABI, events (Mint/Burn/Swap/Sync/Transfer/Approval),
 *               TWAP oracle accumulators and EIP-2612 `permit` follow
 *               Uniswap V2, so existing V2 indexers/SDKs work with minimal changes.
 *  ADDRESSES    Pair address is deterministic (CREATE2):
 *               salt = keccak256(abi.encodePacked(token0, token1)),
 *               init code hash = `VibeFactory.getInitCodeHash()`.
 *  GAS          Custom errors instead of revert strings (cheaper reverts).
 *
 *  DIFFERENCES vs Uniswap V2 (integrators must account for these):
 *   - Flash-swap callback is `vibeCall(...)` (not `uniswapV2Call`).
 *   - Fee math uses 10000 basis: amountIn * 9975 / 10000.
 *   - MINIMUM_LIQUIDITY = 1e5 (burned on first mint).
 *   - `swap` reverts if `to` is token0 or token1.
 *   - Reverts use custom errors (e.g. `VibeInvalidK()`), not strings.
 *
 *  ADMIN POWERS (fully disclosed):
 *   - `feeToSetter`: set protocol fee recipient, transfer the role, open/close
 *     permissionless pair creation.
 *   - `owner`: pause/unpause NEW pair creation only. Existing pairs are never
 *     paused and user funds in pairs cannot be moved by any admin.
 * ============================================================================
 */

// ==========================================
// CUSTOM ERRORS (Gas Optimization)
// ==========================================
error VibeForbidden();
error VibeExpired();
error VibeInsufficientLiquidity();
error VibeInsufficientLiquidityMinted();
error VibeInsufficientLiquidityBurned();
error VibeInsufficientOutputAmount();
error VibeInsufficientInputAmount();
error VibeInvalidK();
error VibeTransferFailed();
error VibeIdenticalAddresses();
error VibeZeroAddress();
error VibePairExists();
error VibeLocked();
error VibeOverflow();

// ==========================================
// INTERFACES
// ==========================================
/// @notice Flash-swap callback. Implement this on the `to` contract when calling
///         `VibePair.swap` with non-empty `data` (equivalent to `uniswapV2Call`).
/// @dev Before returning, the callee must transfer enough input tokens to the pair so
///      the 0.25% fee-adjusted constant-product invariant holds, otherwise the swap reverts.
interface IVibeCallee {
    function vibeCall(address sender, uint amount0, uint amount1, bytes calldata data) external;
}

// ==========================================
// MATH LIBRARIES
// ==========================================
library Math {
    function min(uint x, uint y) internal pure returns (uint z) {
        z = x < y ? x : y;
    }
    function sqrt(uint y) internal pure returns (uint z) {
        if (y > 3) {
            z = y;
            uint x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}

library UQ112x112 {
    uint224 constant Q112 = 2**112;
    function encode(uint112 y) internal pure returns (uint224 z) {
        z = uint224(y) * Q112;
    }
    function uqdiv(uint224 x, uint112 y) internal pure returns (uint224 z) {
        z = x / uint224(y);
    }
}

// ==========================================
// VIBE ERC20 (LP TOKEN)
// ==========================================
/// @title VibeERC20 — LP token ("VIBE-LP") with EIP-2612 permit
/// @notice Represents a pro-rata share of a VibePair's reserves plus accrued swap fees.
contract VibeERC20 {
    string public constant name = "Vibe LPs";
    string public constant symbol = "VIBE-LP";
    uint8 public constant decimals = 18;
    uint  public totalSupply;
    mapping(address => uint) public balanceOf;
    mapping(address => mapping(address => uint)) public allowance;

    bytes32 public DOMAIN_SEPARATOR;
    bytes32 public constant PERMIT_TYPEHASH = 0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9;
    mapping(address => uint) public nonces;

    event Approval(address indexed owner, address indexed spender, uint value);
    event Transfer(address indexed from, address indexed to, uint value);

    constructor() {
        uint chainId;
        assembly { chainId := chainid() }
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes("1")),
                chainId,
                address(this)
            )
        );
    }

    function _mint(address to, uint value) internal {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function _burn(address from, uint value) internal {
        balanceOf[from] -= value;
        totalSupply -= value;
        emit Transfer(from, address(0), value);
    }

    function _approve(address owner, address spender, uint value) private {
        allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
    }

    function approve(address spender, uint value) external returns (bool) {
        _approve(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint value) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint).max) {
            allowance[from][msg.sender] -= value;
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint value) private {
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    function permit(address owner, address spender, uint value, uint deadline, uint8 v, bytes32 r, bytes32 s) external {
        if (deadline < block.timestamp) revert VibeExpired();
        bytes32 digest = keccak256(
            abi.encodePacked(
                '\x19\x01',
                DOMAIN_SEPARATOR,
                keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline))
            )
        );
        address recoveredAddress = ecrecover(digest, v, r, s);
        if (recoveredAddress == address(0) || recoveredAddress != owner) revert VibeForbidden();
        _approve(owner, spender, value);
    }
}

// ==========================================
// VIBE PAIR (THE POOL)
// ==========================================
/// @title VibePair — constant-product liquidity pool for one token pair
/// @notice Non-custodial: no owner, no admin withdrawal, no pause. Funds leave only via
///         `burn` (LP redemption), `swap` (invariant-checked) and `skim` (excess over reserves).
/// @dev Low-level contract. EOAs should use VibeRouter, which adds slippage and deadline checks.
contract VibePair is VibeERC20, ReentrancyGuard {
    using UQ112x112 for uint224;

    uint public constant MINIMUM_LIQUIDITY = 10**5;
    bytes4 private constant SELECTOR = bytes4(keccak256(bytes('transfer(address,uint256)')));

    address public factory;
    address public token0;
    address public token1;

    uint112 private reserve0;           
    uint112 private reserve1;           
    uint32  private blockTimestampLast; 

    uint public price0CumulativeLast;
    uint public price1CumulativeLast;
    uint public kLast; 

    // Mutex lock for local protection (in addition to ReentrancyGuard)
    uint private unlocked = 1;
    modifier lock() {
        if (unlocked == 0) revert VibeLocked();
        unlocked = 0;
        _;
        unlocked = 1;
    }

    event Mint(address indexed sender, uint amount0, uint amount1);
    event Burn(address indexed sender, uint amount0, uint amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint amount0In,
        uint amount1In,
        uint amount0Out,
        uint amount1Out,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);

    constructor() {
        factory = msg.sender;
    }

    function initialize(address _token0, address _token1) external {
        if (msg.sender != factory) revert VibeForbidden();
        token0 = _token0;
        token1 = _token1;
    }

    /// @notice Current reserves and timestamp of last update. Use for quoting:
    ///         amountOut = (amountIn * 9975 * rOut) / (rIn * 10000 + amountIn * 9975).
    function getReserves() public view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast) {
        _reserve0 = reserve0;
        _reserve1 = reserve1;
        _blockTimestampLast = blockTimestampLast;
    }

    function _safeTransfer(address token, address to, uint value) private {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(SELECTOR, to, value));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert VibeTransferFailed();
    }

    function _update(uint balance0, uint balance1, uint112 _reserve0, uint112 _reserve1) private {
        if (balance0 > type(uint112).max || balance1 > type(uint112).max) revert VibeOverflow();
        uint32 blockTimestamp = uint32(block.timestamp % 2**32);
        uint32 timeElapsed;
        unchecked {
            timeElapsed = blockTimestamp - blockTimestampLast; // overflow is desired
        }
        
        if (timeElapsed > 0 && _reserve0 != 0 && _reserve1 != 0) {
            // NEVER ever use SafeMath here, we want overflow for the Oracle to work properly
            unchecked {
                price0CumulativeLast += uint(UQ112x112.encode(_reserve1).uqdiv(_reserve0)) * timeElapsed;
                price1CumulativeLast += uint(UQ112x112.encode(_reserve0).uqdiv(_reserve1)) * timeElapsed;
            }
        }
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
        blockTimestampLast = blockTimestamp;
        emit Sync(reserve0, reserve1);
    }

    function _mintFee(uint112 _reserve0, uint112 _reserve1) private returns (bool feeOn) {
        address feeTo = VibeFactory(factory).feeTo();
        feeOn = feeTo != address(0);
        uint _kLast = kLast; 
        if (feeOn) {
            if (_kLast != 0) {
                uint rootK = Math.sqrt(uint(_reserve0) * _reserve1);
                uint rootKLast = Math.sqrt(_kLast);
                if (rootK > rootKLast) {
                    uint numerator = totalSupply * (rootK - rootKLast);
                    uint denominator = (rootK * 5) + rootKLast; 
                    uint liquidity = numerator / denominator;
                    if (liquidity > 0) _mint(feeTo, liquidity);
                }
            }
        } else if (_kLast != 0) {
            kLast = 0;
        }
    }

    /// @notice Mints LP tokens to `to` for tokens transferred to the pair beforehand.
    /// @dev Must be called atomically after the transfers (use the Router).
    function mint(address to) external lock nonReentrant returns (uint liquidity) {
        (uint112 _reserve0, uint112 _reserve1,) = getReserves(); 
        uint balance0 = IERC20(token0).balanceOf(address(this));
        uint balance1 = IERC20(token1).balanceOf(address(this));
        uint amount0 = balance0 - _reserve0;
        uint amount1 = balance1 - _reserve1;

        bool feeOn = _mintFee(_reserve0, _reserve1);
        uint _totalSupply = totalSupply; 
        if (_totalSupply == 0) {
            liquidity = Math.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            _mint(address(0), MINIMUM_LIQUIDITY); 
        } else {
            liquidity = Math.min(amount0 * _totalSupply / _reserve0, amount1 * _totalSupply / _reserve1);
        }
        if (liquidity == 0) revert VibeInsufficientLiquidityMinted();
        _mint(to, liquidity);

        _update(balance0, balance1, _reserve0, _reserve1);
        if (feeOn) kLast = uint(reserve0) * reserve1;
        emit Mint(msg.sender, amount0, amount1);
    }

    /// @notice Burns LP tokens held by the pair and sends the underlying tokens to `to`.
    /// @dev Transfer LP tokens to the pair first, in the same transaction (use the Router).
    function burn(address to) external lock nonReentrant returns (uint amount0, uint amount1) {
        (uint112 _reserve0, uint112 _reserve1,) = getReserves();
        address _token0 = token0;                                
        address _token1 = token1;                                
        uint balance0 = IERC20(_token0).balanceOf(address(this));
        uint balance1 = IERC20(_token1).balanceOf(address(this));
        uint liquidity = balanceOf[address(this)];

        bool feeOn = _mintFee(_reserve0, _reserve1);
        uint _totalSupply = totalSupply; 
        amount0 = liquidity * balance0 / _totalSupply;
        amount1 = liquidity * balance1 / _totalSupply;
        if (amount0 == 0 || amount1 == 0) revert VibeInsufficientLiquidityBurned();
        _burn(address(this), liquidity);
        _safeTransfer(_token0, to, amount0);
        _safeTransfer(_token1, to, amount1);
        balance0 = IERC20(_token0).balanceOf(address(this));
        balance1 = IERC20(_token1).balanceOf(address(this));

        _update(balance0, balance1, _reserve0, _reserve1);
        if (feeOn) kLast = uint(reserve0) * reserve1;
        emit Burn(msg.sender, amount0, amount1, to);
    }

    /// @notice Sends `amount0Out`/`amount1Out` to `to`, then enforces the 0.25% fee-adjusted
    ///         invariant. Supports flash swaps via `IVibeCallee.vibeCall` when `data` is non-empty.
    function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external lock nonReentrant {
        if (amount0Out == 0 && amount1Out == 0) revert VibeInsufficientOutputAmount();
        (uint112 _reserve0, uint112 _reserve1,) = getReserves();
        if (amount0Out >= _reserve0 || amount1Out >= _reserve1) revert VibeInsufficientLiquidity();

        uint balance0;
        uint balance1;
        { 
            address _token0 = token0;
            address _token1 = token1;
            if (to == _token0 || to == _token1) revert VibeForbidden(); // Prevent sending to self
            if (amount0Out > 0) _safeTransfer(_token0, to, amount0Out); 
            if (amount1Out > 0) _safeTransfer(_token1, to, amount1Out); 
            if (data.length > 0) IVibeCallee(to).vibeCall(msg.sender, amount0Out, amount1Out, data);
            balance0 = IERC20(_token0).balanceOf(address(this));
            balance1 = IERC20(_token1).balanceOf(address(this));
        }
        uint amount0In = balance0 > _reserve0 - amount0Out ? balance0 - (_reserve0 - amount0Out) : 0;
        uint amount1In = balance1 > _reserve1 - amount1Out ? balance1 - (_reserve1 - amount1Out) : 0;
        if (amount0In == 0 && amount1In == 0) revert VibeInsufficientInputAmount();
        { 
            // 0.25% fee adjusted
            uint balance0Adjusted = balance0 * 10000 - amount0In * 25;
            uint balance1Adjusted = balance1 * 10000 - amount1In * 25;
            if (balance0Adjusted * balance1Adjusted < uint(_reserve0) * _reserve1 * 10000**2) revert VibeInvalidK();
        }

        _update(balance0, balance1, _reserve0, _reserve1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    /// @notice Sends token balances in excess of the recorded reserves to `to`.
    function skim(address to) external lock {
        address _token0 = token0; 
        address _token1 = token1; 
        _safeTransfer(_token0, to, IERC20(_token0).balanceOf(address(this)) - reserve0);
        _safeTransfer(_token1, to, IERC20(_token1).balanceOf(address(this)) - reserve1);
    }

    /// @notice Forces reserves to match current token balances.
    function sync() external lock {
        _update(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)), reserve0, reserve1);
    }
}

// ==========================================
// VIBE FACTORY (Master Launch Edition)
// ==========================================
/// @title VibeFactory — deploys and indexes VibePair pools via CREATE2
/// @notice `getPair(tokenA, tokenB)` works in both token orders. `getInitCodeHash()` returns
///         the hash needed to compute pair addresses off-chain.
contract VibeFactory is Ownable, Pausable {
    address public feeTo;
    address public feeToSetter;

    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    // >>> NUEVA FUNCIONALIDAD: INTERRUPTOR DE SEGURIDAD <<<
    // false = Solo Admin puede crear pares.
    // true = Cualquiera puede crear pares (Modo Público).
    bool public isPairCreationOpen = false;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint);
    // >>> NUEVO EVENTO <<<
    event PairCreationStatusChanged(bool isOpen);

    constructor(address _feeToSetter) Ownable(msg.sender) {
        feeToSetter = _feeToSetter;
    }

    function allPairsLength() external view returns (uint) {
        return allPairs.length;
    }

    // >>> NUEVA FUNCION DE CONTROL <<<
    function setPairCreationStatus(bool _isOpen) external {
        if (msg.sender != feeToSetter) revert VibeForbidden();
        isPairCreationOpen = _isOpen;
        emit PairCreationStatusChanged(_isOpen);
    }

    function createPair(address tokenA, address tokenB) external whenNotPaused returns (address pair) {
        // >>> COMPUERTA DE SEGURIDAD AÑADIDA <<<
        if (!isPairCreationOpen && msg.sender != feeToSetter) revert VibeForbidden();

        // [LOGICA ORIGINAL INTACTA]
        if (tokenA == tokenB) revert VibeIdenticalAddresses();
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0)) revert VibeZeroAddress();
        if (getPair[token0][token1] != address(0)) revert VibePairExists();
        
        bytes memory bytecode = type(VibePair).creationCode;
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        assembly {
            pair := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        
        VibePair(pair).initialize(token0, token1);
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair; 
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function setFeeTo(address _feeTo) external {
        if (msg.sender != feeToSetter) revert VibeForbidden();
        feeTo = _feeTo;
    }

    function setFeeToSetter(address _feeToSetter) external {
        if (msg.sender != feeToSetter) revert VibeForbidden();
        feeToSetter = _feeToSetter;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function getInitCodeHash() external pure returns (bytes32) {
        return keccak256(type(VibePair).creationCode);
    }
}
