// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title Wrapped DOT (WDOT)
/// @author SoneVibe Finance
/// @notice ERC20 wrapper for native DOT on Polkadot Hub Revive
/// @dev WETH9-style implementation, compatible with Uniswap V2/V3 routers

contract WrappedDOT {
    /*//////////////////////////////////////////////////////////////
                               EVENTS
    //////////////////////////////////////////////////////////////*/

    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Deposit(address indexed from, uint256 amount);
    event Withdrawal(address indexed to, uint256 amount);

    /*//////////////////////////////////////////////////////////////
                               METADATA
    //////////////////////////////////////////////////////////////*/

    string public constant name = "Wrapped DOT";
    string public constant symbol = "WDOT";
    uint8  public constant decimals = 18;

    /*//////////////////////////////////////////////////////////////
                               STORAGE
    //////////////////////////////////////////////////////////////*/

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    /*//////////////////////////////////////////////////////////////
                           RECEIVE / DEPOSIT
    //////////////////////////////////////////////////////////////*/

    receive() external payable {
        _deposit(msg.sender, msg.value);
    }

    function deposit() external payable {
        _deposit(msg.sender, msg.value);
    }

    function _deposit(address account, uint256 amount) internal {
        require(amount > 0, "WDOT: zero deposit");
        balanceOf[account] += amount;
        emit Deposit(account, amount);
        emit Transfer(address(0), account, amount);
    }

    /*//////////////////////////////////////////////////////////////
                           WITHDRAW
    //////////////////////////////////////////////////////////////*/

    function withdraw(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "WDOT: insufficient balance");
        balanceOf[msg.sender] -= amount;

        emit Transfer(msg.sender, address(0), amount);
        emit Withdrawal(msg.sender, amount);

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "WDOT: DOT transfer failed");
    }

    /*//////////////////////////////////////////////////////////////
                           ERC20 LOGIC
    //////////////////////////////////////////////////////////////*/

    function totalSupply() external view returns (uint256) {
        return address(this).balance;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        return _transfer(msg.sender, to, value);
    }

    function transferFrom(
        address from,
        address to,
        uint256 value
    ) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "WDOT: allowance exceeded");
            allowance[from][msg.sender] = allowed - value;
        }
        return _transfer(from, to, value);
    }

    function _transfer(
        address from,
        address to,
        uint256 value
    ) internal returns (bool) {
        require(balanceOf[from] >= value, "WDOT: balance too low");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
        return true;
    }
}
