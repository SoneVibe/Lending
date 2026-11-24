// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Multicall.sol";

/*
 * ============================================================================
 *  SONEVIBE DEX — ROUTER
 * ============================================================================
 *  Integration summary for developers, aggregators, bots and AI agents:
 *
 *  INTERFACE    Same function names and signatures as UniswapV2Router02 for
 *               add/remove liquidity, all swap variants (exact-in / exact-out,
 *               native ETH/BNB, fee-on-transfer tokens) and quote helpers.
 *               Not included: `removeLiquidityWithPermit*` and
 *               `removeLiquidityETHSupportingFeeOnTransferTokens`.
 *  SWAP FEE     0.25% per hop (amountIn * 9975 / 10000).
 *  SAFETY       Every state-changing call enforces `deadline` and min/max
 *               slippage bounds, is `nonReentrant`, and uses SafeERC20.
 *  BATCHING     Inherits OpenZeppelin `Multicall`: several router calls can be
 *               batched in one transaction via `multicall(bytes[])`.
 *  QUOTING      `getAmountsOut` / `getAmountsIn` are view functions; call them
 *               off-chain to compute `amountOutMin` / `amountInMax`.
 *  NATIVE COIN  `WETH` is the wrapped native token of the chain (e.g. WETH on
 *               Soneium, WBNB on BNB Chain).
 *
 *  ADMIN POWERS (fully disclosed):
 *   - `owner` can pause/unpause the Router. Pairs are never paused: liquidity
 *     can always be withdrawn by calling the Pair directly.
 *   - `owner` can recover tokens/ETH accidentally sent to the Router. The Router
 *     never holds user funds between transactions.
 * ============================================================================
 */

// ==========================================
// INTERFACES
// ==========================================
interface IVibeFactory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
    function createPair(address tokenA, address tokenB) external returns (address pair);
}

interface IVibePair {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function mint(address to) external returns (uint liquidity);
    function burn(address to) external returns (uint amount0, uint amount1);
    function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external;
}

interface IWETH {
    function deposit() external payable;
    function transfer(address to, uint value) external returns (bool);
    function withdraw(uint) external;
}

// ==========================================
// VIBE LIBRARY (The Brains)
// ==========================================
/// @title VibeLibrary — pure/view helpers for pair addresses and AMM quotes
library VibeLibrary {
    using SafeERC20 for IERC20;

    // -----------------------------------------------------------------------
    // CRITICAL: MUST equal VibeFactory.getInitCodeHash() of the factory this
    // router is deployed with. Any change to VibePair (or to the compiler /
    // OpenZeppelin version / optimizer settings) changes this hash.
    // -----------------------------------------------------------------------
    bytes32 internal constant PAIR_INIT_CODE_HASH = hex'87b780b5d19df9ad0d4c866dcd6b169f14846fb24232a128b678c5bdb395b012'; 

    function sortTokens(address tokenA, address tokenB) internal pure returns (address token0, address token1) {
        require(tokenA != tokenB, 'VibeLibrary: IDENTICAL_ADDRESSES');
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), 'VibeLibrary: ZERO_ADDRESS');
    }

    function pairFor(address factory, address tokenA, address tokenB) internal pure returns (address pair) {
        (address token0, address token1) = sortTokens(tokenA, tokenB);
        pair = address(uint160(uint(keccak256(abi.encodePacked(
            hex'ff',
            factory,
            keccak256(abi.encodePacked(token0, token1)),
            PAIR_INIT_CODE_HASH
        )))));
    }

    function getReserves(address factory, address tokenA, address tokenB) internal view returns (uint reserveA, uint reserveB) {
        (address token0,) = sortTokens(tokenA, tokenB);
        (uint reserve0, uint reserve1,) = IVibePair(pairFor(factory, tokenA, tokenB)).getReserves();
        (reserveA, reserveB) = tokenA == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
    }

    function quote(uint amountA, uint reserveA, uint reserveB) internal pure returns (uint amountB) {
        require(amountA > 0, 'VibeLibrary: INSUFFICIENT_AMOUNT');
        require(reserveA > 0 && reserveB > 0, 'VibeLibrary: INSUFFICIENT_LIQUIDITY');
        amountB = amountA * reserveB / reserveA;
    }

    function getAmountOut(uint amountIn, uint reserveIn, uint reserveOut) internal pure returns (uint amountOut) {
        require(amountIn > 0, 'VibeLibrary: INSUFFICIENT_INPUT_AMOUNT');
        require(reserveIn > 0 && reserveOut > 0, 'VibeLibrary: INSUFFICIENT_LIQUIDITY');
        uint amountInWithFee = amountIn * 9975;
        uint numerator = amountInWithFee * reserveOut;
        uint denominator = reserveIn * 10000 + amountInWithFee;
        amountOut = numerator / denominator;
    }

    function getAmountIn(uint amountOut, uint reserveIn, uint reserveOut) internal pure returns (uint amountIn) {
        require(amountOut > 0, 'VibeLibrary: INSUFFICIENT_OUTPUT_AMOUNT');
        require(reserveIn > 0 && reserveOut > 0, 'VibeLibrary: INSUFFICIENT_LIQUIDITY');
        uint numerator = reserveIn * amountOut * 10000;
        uint denominator = (reserveOut - amountOut) * 9975;
        amountIn = (numerator / denominator) + 1;
    }

    function getAmountsOut(address factory, uint amountIn, address[] memory path) internal view returns (uint[] memory amounts) {
        require(path.length >= 2, 'VibeLibrary: INVALID_PATH');
        amounts = new uint[](path.length);
        amounts[0] = amountIn;
        for (uint i; i < path.length - 1; i++) {
            (uint reserveIn, uint reserveOut) = getReserves(factory, path[i], path[i + 1]);
            amounts[i + 1] = getAmountOut(amounts[i], reserveIn, reserveOut);
        }
    }

    function getAmountsIn(address factory, uint amountOut, address[] memory path) internal view returns (uint[] memory amounts) {
        require(path.length >= 2, 'VibeLibrary: INVALID_PATH');
        amounts = new uint[](path.length);
        amounts[amounts.length - 1] = amountOut;
        for (uint i = path.length - 1; i > 0; i--) {
            (uint reserveIn, uint reserveOut) = getReserves(factory, path[i - 1], path[i]);
            amounts[i - 1] = getAmountIn(amounts[i], reserveIn, reserveOut);
        }
    }
}

// ==========================================
// VIBE ROUTER
// ==========================================
/// @title VibeRouter — user-facing entry point for swaps and liquidity on SoneVibe DEX
/// @notice Approve this contract for the input token, then call a swap or liquidity function.
///         `path` is an ordered token list; each consecutive pair must exist in the factory.
contract VibeRouter is Ownable, Pausable, ReentrancyGuard, Multicall {
    using SafeERC20 for IERC20; 

    address public immutable factory;
    address public immutable WETH;

    modifier ensure(uint deadline) {
        require(deadline >= block.timestamp, 'VibeRouter: EXPIRED');
        _;
    }

    constructor(address _factory, address _WETH) Ownable(msg.sender) {
        factory = _factory;
        WETH = _WETH;
    }

    receive() external payable {
        assert(msg.sender == WETH); 
    }

    // **** ADMIN EMERGENCY ****
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // **** ADD LIQUIDITY ****
    function _addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin
    ) internal virtual returns (uint amountA, uint amountB) {
        if (IVibeFactory(factory).getPair(tokenA, tokenB) == address(0)) {
            IVibeFactory(factory).createPair(tokenA, tokenB);
        }
        (uint reserveA, uint reserveB) = VibeLibrary.getReserves(factory, tokenA, tokenB);
        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint amountBOptimal = VibeLibrary.quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                require(amountBOptimal >= amountBMin, 'VibeRouter: INSUFFICIENT_B_AMOUNT');
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint amountAOptimal = VibeLibrary.quote(amountBDesired, reserveB, reserveA);
                assert(amountAOptimal <= amountADesired);
                require(amountAOptimal >= amountAMin, 'VibeRouter: INSUFFICIENT_A_AMOUNT');
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }
    }

    // [FIX STACK TOO DEEP]: Se eliminó el modifier 'ensure' y se puso el require dentro.
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external virtual nonReentrant whenNotPaused returns (uint amountA, uint amountB, uint liquidity) {
        require(deadline >= block.timestamp, 'VibeRouter: EXPIRED'); // <--- Modifier inlined
        
        (amountA, amountB) = _addLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin);
        address pair = VibeLibrary.pairFor(factory, tokenA, tokenB);
        
        IERC20(tokenA).safeTransferFrom(msg.sender, pair, amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, pair, amountB);
        liquidity = IVibePair(pair).mint(to);
    }

    // [FIX STACK TOO DEEP]: Se eliminó el modifier 'ensure' y se puso el require dentro.
    function addLiquidityETH(
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external virtual payable nonReentrant whenNotPaused returns (uint amountToken, uint amountETH, uint liquidity) {
        require(deadline >= block.timestamp, 'VibeRouter: EXPIRED'); // <--- Modifier inlined

        (amountToken, amountETH) = _addLiquidity(
            token,
            WETH,
            amountTokenDesired,
            msg.value,
            amountTokenMin,
            amountETHMin
        );
        address pair = VibeLibrary.pairFor(factory, token, WETH);
        
        IERC20(token).safeTransferFrom(msg.sender, pair, amountToken);
        IWETH(WETH).deposit{value: amountETH}();
        assert(IWETH(WETH).transfer(pair, amountETH));
        liquidity = IVibePair(pair).mint(to);
        if (msg.value > amountETH) _safeTransferETH(msg.sender, msg.value - amountETH);
    }

    // **** REMOVE LIQUIDITY ****

    function _removeLiquidity(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to
    ) internal virtual returns (uint amountA, uint amountB) {
        address pair = VibeLibrary.pairFor(factory, tokenA, tokenB);
        IERC20(pair).safeTransferFrom(msg.sender, pair, liquidity); 
        (uint amount0, uint amount1) = IVibePair(pair).burn(to);
        (address token0,) = VibeLibrary.sortTokens(tokenA, tokenB);
        (amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);
        require(amountA >= amountAMin, 'VibeRouter: INSUFFICIENT_A_AMOUNT');
        require(amountB >= amountBMin, 'VibeRouter: INSUFFICIENT_B_AMOUNT');
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) public virtual ensure(deadline) nonReentrant whenNotPaused returns (uint amountA, uint amountB) {
        return _removeLiquidity(tokenA, tokenB, liquidity, amountAMin, amountBMin, to);
    }

    function removeLiquidityETH(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) public virtual ensure(deadline) nonReentrant whenNotPaused returns (uint amountToken, uint amountETH) {
        (amountToken, amountETH) = _removeLiquidity(
            token,
            WETH,
            liquidity,
            amountTokenMin,
            amountETHMin,
            address(this) 
        );
        IERC20(token).safeTransfer(to, amountToken);
        IWETH(WETH).withdraw(amountETH);
        _safeTransferETH(to, amountETH);
    }

    // **** SWAP ****
    function _swap(uint[] memory amounts, address[] memory path, address _to) internal virtual {
        for (uint i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = VibeLibrary.sortTokens(input, output);
            uint amountOut = amounts[i + 1];
            (uint amount0Out, uint amount1Out) = input == token0 ? (uint(0), amountOut) : (amountOut, uint(0));
            address to = i < path.length - 2 ? VibeLibrary.pairFor(factory, output, path[i + 2]) : _to;
            IVibePair(VibeLibrary.pairFor(factory, input, output)).swap(
                amount0Out, amount1Out, to, new bytes(0)
            );
        }
    }

    /// @notice Swaps an exact `amountIn` of path[0] for at least `amountOutMin` of path[last].
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external virtual ensure(deadline) nonReentrant whenNotPaused returns (uint[] memory amounts) {
        amounts = VibeLibrary.getAmountsOut(factory, amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, 'VibeRouter: INSUFFICIENT_OUTPUT_AMOUNT');
        IERC20(path[0]).safeTransferFrom(msg.sender, VibeLibrary.pairFor(factory, path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
    }

    /// @notice Receives exactly `amountOut` of path[last], spending at most `amountInMax` of path[0].
    function swapTokensForExactTokens(
        uint amountOut,
        uint amountInMax,
        address[] calldata path,
        address to,
        uint deadline
    ) external virtual ensure(deadline) nonReentrant whenNotPaused returns (uint[] memory amounts) {
        amounts = VibeLibrary.getAmountsIn(factory, amountOut, path);
        require(amounts[0] <= amountInMax, 'VibeRouter: EXCESSIVE_INPUT_AMOUNT');
        IERC20(path[0]).safeTransferFrom(msg.sender, VibeLibrary.pairFor(factory, path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
    }

    function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline)
        external
        virtual
        payable
        ensure(deadline)
        nonReentrant
        whenNotPaused
        returns (uint[] memory amounts)
    {
        require(path[0] == WETH, 'VibeRouter: INVALID_PATH');
        amounts = VibeLibrary.getAmountsOut(factory, msg.value, path);
        require(amounts[amounts.length - 1] >= amountOutMin, 'VibeRouter: INSUFFICIENT_OUTPUT_AMOUNT');
        IWETH(WETH).deposit{value: amounts[0]}();
        assert(IWETH(WETH).transfer(VibeLibrary.pairFor(factory, path[0], path[1]), amounts[0]));
        _swap(amounts, path, to);
    }

    function swapTokensForExactETH(uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline)
        external
        virtual
        ensure(deadline)
        nonReentrant
        whenNotPaused
        returns (uint[] memory amounts)
    {
        require(path[path.length - 1] == WETH, 'VibeRouter: INVALID_PATH');
        amounts = VibeLibrary.getAmountsIn(factory, amountOut, path);
        require(amounts[0] <= amountInMax, 'VibeRouter: EXCESSIVE_INPUT_AMOUNT');
        IERC20(path[0]).safeTransferFrom(msg.sender, VibeLibrary.pairFor(factory, path[0], path[1]), amounts[0]);
        _swap(amounts, path, address(this));
        IWETH(WETH).withdraw(amounts[amounts.length - 1]);
        _safeTransferETH(to, amounts[amounts.length - 1]);
    }

    function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)
        external
        virtual
        ensure(deadline)
        nonReentrant
        whenNotPaused
        returns (uint[] memory amounts)
    {
        require(path[path.length - 1] == WETH, 'VibeRouter: INVALID_PATH');
        amounts = VibeLibrary.getAmountsOut(factory, amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, 'VibeRouter: INSUFFICIENT_OUTPUT_AMOUNT');
        IERC20(path[0]).safeTransferFrom(msg.sender, VibeLibrary.pairFor(factory, path[0], path[1]), amounts[0]);
        _swap(amounts, path, address(this));
        IWETH(WETH).withdraw(amounts[amounts.length - 1]);
        _safeTransferETH(to, amounts[amounts.length - 1]);
    }

    function swapETHForExactTokens(uint amountOut, address[] calldata path, address to, uint deadline)
        external
        virtual
        payable
        ensure(deadline)
        nonReentrant
        whenNotPaused
        returns (uint[] memory amounts)
    {
        require(path[0] == WETH, 'VibeRouter: INVALID_PATH');
        amounts = VibeLibrary.getAmountsIn(factory, amountOut, path);
        require(amounts[0] <= msg.value, 'VibeRouter: EXCESSIVE_INPUT_AMOUNT');
        IWETH(WETH).deposit{value: amounts[0]}();
        assert(IWETH(WETH).transfer(VibeLibrary.pairFor(factory, path[0], path[1]), amounts[0]));
        _swap(amounts, path, to);
        if (msg.value > amounts[0]) _safeTransferETH(msg.sender, msg.value - amounts[0]);
    }

    // **** SWAP SUPPORTING FEE-ON-TRANSFER TOKENS ****
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external virtual ensure(deadline) nonReentrant whenNotPaused {
        IERC20(path[0]).safeTransferFrom(msg.sender, VibeLibrary.pairFor(factory, path[0], path[1]), amountIn);
        uint balanceBefore = IERC20(path[path.length - 1]).balanceOf(to);
        _swapSupportingFeeOnTransferTokens(path, to);
        require(
            IERC20(path[path.length - 1]).balanceOf(to) - balanceBefore >= amountOutMin,
            'VibeRouter: INSUFFICIENT_OUTPUT_AMOUNT'
        );
    }

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external virtual payable ensure(deadline) nonReentrant whenNotPaused {
        require(path[0] == WETH, 'VibeRouter: INVALID_PATH');
        uint amountIn = msg.value;
        IWETH(WETH).deposit{value: amountIn}();
        assert(IWETH(WETH).transfer(VibeLibrary.pairFor(factory, path[0], path[1]), amountIn));
        uint balanceBefore = IERC20(path[path.length - 1]).balanceOf(to);
        _swapSupportingFeeOnTransferTokens(path, to);
        require(
            IERC20(path[path.length - 1]).balanceOf(to) - balanceBefore >= amountOutMin,
            'VibeRouter: INSUFFICIENT_OUTPUT_AMOUNT'
        );
    }

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external virtual ensure(deadline) nonReentrant whenNotPaused {
        require(path[path.length - 1] == WETH, 'VibeRouter: INVALID_PATH');
        IERC20(path[0]).safeTransferFrom(msg.sender, VibeLibrary.pairFor(factory, path[0], path[1]), amountIn);
        _swapSupportingFeeOnTransferTokens(path, address(this));
        uint amountOut = IERC20(WETH).balanceOf(address(this));
        require(amountOut >= amountOutMin, 'VibeRouter: INSUFFICIENT_OUTPUT_AMOUNT');
        IWETH(WETH).withdraw(amountOut);
        _safeTransferETH(to, amountOut);
    }

    function _swapSupportingFeeOnTransferTokens(address[] memory path, address _to) internal virtual {
        for (uint i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = VibeLibrary.sortTokens(input, output);
            IVibePair pair = IVibePair(VibeLibrary.pairFor(factory, input, output));
            uint amountInput;
            uint amountOutput;
            { // scope to avoid stack too deep errors
            (uint reserve0, uint reserve1,) = pair.getReserves();
            (uint reserveInput, uint reserveOutput) = input == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
            amountInput = IERC20(input).balanceOf(address(pair)) - reserveInput;
            amountOutput = VibeLibrary.getAmountOut(amountInput, reserveInput, reserveOutput);
            }
            (uint amount0Out, uint amount1Out) = input == token0 ? (uint(0), amountOutput) : (amountOutput, uint(0));
            address to = i < path.length - 2 ? VibeLibrary.pairFor(factory, output, path[i + 2]) : _to;
            pair.swap(amount0Out, amount1Out, to, new bytes(0));
        }
    }

    function _safeTransferETH(address to, uint value) internal {
        (bool success,) = to.call{value: value}(new bytes(0));
        require(success, 'VibeRouter: ETH_TRANSFER_FAILED');
    }
        // ==========================================
    // FUNCIONES DE LECTURA (PARA EL FRONTEND)
    // ==========================================

    function quote(uint amountA, uint reserveA, uint reserveB) public pure returns (uint amountB) {
        return VibeLibrary.quote(amountA, reserveA, reserveB);
    }

    function getAmountOut(uint amountIn, uint reserveIn, uint reserveOut) public pure returns (uint amountOut) {
        return VibeLibrary.getAmountOut(amountIn, reserveIn, reserveOut);
    }

    function getAmountIn(uint amountOut, uint reserveIn, uint reserveOut) public pure returns (uint amountIn) {
        return VibeLibrary.getAmountIn(amountOut, reserveIn, reserveOut);
    }

    function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts) {
        return VibeLibrary.getAmountsOut(factory, amountIn, path);
    }

    function getAmountsIn(uint amountOut, address[] memory path) public view returns (uint[] memory amounts) {
        return VibeLibrary.getAmountsIn(factory, amountOut, path);
    }
        // ==========================================
    // EMERGENCY ADMIN RESCUE (CATÁSTROFE)
    // ==========================================
    /**
     * @notice Rescate de emergencia de cualquier activo atascado en el Router.
     * @dev Permite sacar ETH, Tokens ERC20 y LP Tokens. SOLO ADMIN.
     * @param _token La dirección del token a rescatar (usa address(0) para ETH).
     */
    /// @dev Only for assets mistakenly sent to the Router; it cannot access Pair liquidity.
    function rescueFunds(address _token) external onlyOwner {
        if (_token == address(0)) {
            // Rescatar ETH nativo
            uint256 ethBalance = address(this).balance;
            require(ethBalance > 0, "No ETH to rescue");
            (bool success, ) = msg.sender.call{value: ethBalance}("");
            require(success, "ETH rescue failed");
        } else {
            // Rescatar cualquier ERC20 (incluyendo LP Tokens atascados)
            uint256 tokenBalance = IERC20(_token).balanceOf(address(this));
            require(tokenBalance > 0, "No tokens to rescue");
            IERC20(_token).safeTransfer(msg.sender, tokenBalance);
        }
    }
}