// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title SVUSD - Sone Vibe USD
/// @notice Overcollateralized Stablecoin for Soneium.
contract SVUSD {
    // ======================================================
    // ERC20 Data
    // ======================================================
    string public constant name = "Sone Vibe USD";
    string public constant symbol = "SVUSD";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // ======================================================
    // Access Control & State
    // ======================================================
    address public admin;
    bool public paused; // Emergency switch
    mapping(address => bool) public isFacilitator;
    
    struct FacilitatorState {
        uint128 bucketCapacity;
        uint128 bucketLevel;
    }
    mapping(address => FacilitatorState) public facilitatorState;

    // ======================================================
    // Events
    // ======================================================
    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event FacilitatorAdded(address indexed facilitator, uint128 bucketCapacity);
    event FacilitatorRemoved(address indexed facilitator);
    event FacilitatorBucketUpdated(address indexed facilitator, uint128 newCapacity);
    event AdminChanged(address indexed oldAdmin, address indexed newAdmin);
    event Paused(bool isPaused);

    // ======================================================
    // Errors
    // ======================================================
    error NotAdmin();
    error NotFacilitator();
    error BucketExceeded();
    error InsufficientBalance();
    error InsufficientAllowance();
    error ZeroAddress();
    error ContractPaused();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyFacilitator() {
        if (!isFacilitator[msg.sender]) revert NotFacilitator();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    constructor(address _admin) {
        if (_admin == address(0)) revert ZeroAddress();
        admin = _admin;
    }

    // ======================================================
    // ERC20 Logic
    // ======================================================
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - amount;
        }
        return _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        if (to == address(0)) revert ZeroAddress();
        if (balanceOf[from] < amount) revert InsufficientBalance();
        
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    // ======================================================
    // Minter / Burner Logic (Facilitator Only)
    // ======================================================
    function mint(address to, uint256 amount) external onlyFacilitator whenNotPaused {
        FacilitatorState storage fs = facilitatorState[msg.sender];
        uint256 newLevel = uint256(fs.bucketLevel) + amount;
        if (newLevel > fs.bucketCapacity) revert BucketExceeded();
        
        fs.bucketLevel = uint128(newLevel);
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function burn(address from, uint256 amount) external onlyFacilitator whenNotPaused {
        if (balanceOf[from] < amount) revert InsufficientBalance();
        
        FacilitatorState storage fs = facilitatorState[msg.sender];
        uint256 currentLevel = fs.bucketLevel;
        if (amount > currentLevel) {
            fs.bucketLevel = 0;
        } else {
            fs.bucketLevel = uint128(currentLevel - amount);
        }

        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }

    // ======================================================
    // Admin Logic
    // ======================================================
    function setAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        emit AdminChanged(admin, newAdmin);
        admin = newAdmin;
    }

    function setPaused(bool _paused) external onlyAdmin {
        paused = _paused;
        emit Paused(_paused);
    }

    function addFacilitator(address facilitator, uint128 bucketCapacity) external onlyAdmin {
        isFacilitator[facilitator] = true;
        facilitatorState[facilitator] = FacilitatorState(bucketCapacity, 0);
        emit FacilitatorAdded(facilitator, bucketCapacity);
    }

    function removeFacilitator(address facilitator) external onlyAdmin {
        isFacilitator[facilitator] = false;
        delete facilitatorState[facilitator];
        emit FacilitatorRemoved(facilitator);
    }

    function setFacilitatorBucket(address facilitator, uint128 newCapacity) external onlyAdmin {
        if (!isFacilitator[facilitator]) revert NotFacilitator();
        facilitatorState[facilitator].bucketCapacity = newCapacity;
        emit FacilitatorBucketUpdated(facilitator, newCapacity);
    }
}