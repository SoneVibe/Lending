// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title VibeMasterChef
 * @dev The ultimate yield farming contract. Distributes LIGHT tokens to LP stakers.
 *      Optimized for Soneium (OP Stack).
 *      Security: High | Gas Efficiency: High
 */
contract VibeMasterChef is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ==========================================
    // STRUCTS
    // ==========================================

    struct UserInfo {
        uint256 amount;     // How many LP tokens the user has provided.
        uint256 rewardDebt; // Reward debt.
    }

    struct PoolInfo {
        IERC20 lpToken;           // Address of LP token contract.
        uint256 allocPoint;       // How many allocation points assigned to this pool.
        uint256 lastRewardBlock;  // Last block number that LIGHTs distribution occurs.
        uint256 accLightPerShare; // Accumulated LIGHTs per share, times 1e12.
    }

    // ==========================================
    // STATE VARIABLES
    // ==========================================

    // The LIGHT TOKEN!
    IERC20 public lightToken;

    // Block number when LIGHT mining starts.
    uint256 public startBlock;

    // LIGHT tokens created per block.
    uint256 public lightPerBlock;

    // Bonus muliplier for early LIGHT makers.
    uint256 public constant BONUS_MULTIPLIER = 1; // 1x (No bonus to protect inflation)

    // Info of each pool.
    PoolInfo[] public poolInfo;

    // Info of each user that stakes LP tokens.
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;
    
    // SECURITY PATCH: Prevents adding the same LP token twice
    mapping(IERC20 => bool) public poolExistence;

    // Total allocation points. Must be the sum of all allocation points in all pools.
    uint256 public totalAllocPoint = 0;

    // ==========================================
    // EVENTS
    // ==========================================
    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event UpdatePool(uint256 indexed pid, uint256 lastRewardBlock, uint256 lpSupply, uint256 accLightPerShare);
    event SetLightPerBlock(uint256 oldPerBlock, uint256 newPerBlock);
    
    // Custom Errors (Gas Optimization)
    error VibeForbidden();
    error VibePoolExists();
    error VibeInvalidPid();

    // ==========================================
    // CONSTRUCTOR
    // ==========================================
    
    constructor(
        IERC20 _lightToken,
        uint256 _lightPerBlock,
        uint256 _startBlock
    ) Ownable(msg.sender) {
        lightToken = _lightToken;
        lightPerBlock = _lightPerBlock;
        startBlock = _startBlock;
    }

    // ==========================================
    // ADMIN FUNCTIONS
    // ==========================================

    /**
     * @dev Add a new lp to the pool. Can only be called by the owner.
     * SECURITY PATCH APPLIED: Checks if pool already exists.
     */
    function add(uint256 _allocPoint, IERC20 _lpToken, bool _withUpdate) external onlyOwner {
        // --- SECURITY CHECK START ---
        if (poolExistence[_lpToken]) revert VibePoolExists();
        poolExistence[_lpToken] = true;
        // --- SECURITY CHECK END ---

        if (_withUpdate) {
            massUpdatePools();
        }
        uint256 lastRewardBlock = block.number > startBlock ? block.number : startBlock;
        totalAllocPoint = totalAllocPoint + _allocPoint;
        poolInfo.push(PoolInfo({
            lpToken: _lpToken,
            allocPoint: _allocPoint,
            lastRewardBlock: lastRewardBlock,
            accLightPerShare: 0
        }));
    }

    /**
     * @dev Update the given pool's LIGHT allocation point. Can only be called by the owner.
     */
    function set(uint256 _pid, uint256 _allocPoint, bool _withUpdate) external onlyOwner {
        if (_withUpdate) {
            massUpdatePools();
        }
        uint256 prevAllocPoint = poolInfo[_pid].allocPoint;
        poolInfo[_pid].allocPoint = _allocPoint;
        if (prevAllocPoint != _allocPoint) {
            totalAllocPoint = totalAllocPoint - prevAllocPoint + _allocPoint;
        }
    }
    
    /**
     * @dev Updates the emission rate.
     */
    function updateEmissionRate(uint256 _lightPerBlock) external onlyOwner {
        massUpdatePools();
        emit SetLightPerBlock(lightPerBlock, _lightPerBlock);
        lightPerBlock = _lightPerBlock;
    }

    // ==========================================
    // PUBLIC / EXTERNAL VIEWS
    // ==========================================

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    /**
     * @dev View function to see pending LIGHTs on frontend.
     */
    function pendingLight(uint256 _pid, address _user) external view returns (uint256) {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        uint256 accLightPerShare = pool.accLightPerShare;
        uint256 lpSupply = pool.lpToken.balanceOf(address(this));
        
        if (block.number > pool.lastRewardBlock && lpSupply != 0) {
            uint256 multiplier = getMultiplier(pool.lastRewardBlock, block.number);
            uint256 lightReward = multiplier * lightPerBlock * pool.allocPoint / totalAllocPoint;
            accLightPerShare = accLightPerShare + (lightReward * 1e12 / lpSupply);
        }
        return user.amount * accLightPerShare / 1e12 - user.rewardDebt;
    }

    // ==========================================
    // PUBLIC FUNCTIONS
    // ==========================================

    /**
     * @dev Update reward variables for all pools. Be careful of gas spending!
     */
    function massUpdatePools() public {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            updatePool(pid);
        }
    }

    /**
     * @dev Update reward variables of the given pool to be up-to-date.
     */
    function updatePool(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];
        if (block.number <= pool.lastRewardBlock) {
            return;
        }
        uint256 lpSupply = pool.lpToken.balanceOf(address(this));
        if (lpSupply == 0) {
            pool.lastRewardBlock = block.number;
            return;
        }
        uint256 multiplier = getMultiplier(pool.lastRewardBlock, block.number);
        uint256 lightReward = multiplier * lightPerBlock * pool.allocPoint / totalAllocPoint;
        pool.accLightPerShare = pool.accLightPerShare + (lightReward * 1e12 / lpSupply);
        pool.lastRewardBlock = block.number;
        
        emit UpdatePool(_pid, pool.lastRewardBlock, lpSupply, pool.accLightPerShare);
    }

    /**
     * @dev Deposit LP tokens to MasterChef for LIGHT allocation.
     */
    function deposit(uint256 _pid, uint256 _amount) external nonReentrant {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        updatePool(_pid);
        
        if (user.amount > 0) {
            uint256 pending = user.amount * pool.accLightPerShare / 1e12 - user.rewardDebt;
            if (pending > 0) {
                safeLightTransfer(msg.sender, pending);
            }
        }
        
        if (_amount > 0) {
            pool.lpToken.safeTransferFrom(address(msg.sender), address(this), _amount);
            user.amount = user.amount + _amount;
        }
        user.rewardDebt = user.amount * pool.accLightPerShare / 1e12;
        emit Deposit(msg.sender, _pid, _amount);
    }

    /**
     * @dev Withdraw LP tokens from MasterChef.
     */
    function withdraw(uint256 _pid, uint256 _amount) external nonReentrant {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        if (user.amount < _amount) revert VibeForbidden();
        
        updatePool(_pid);
        
        uint256 pending = user.amount * pool.accLightPerShare / 1e12 - user.rewardDebt;
        if (pending > 0) {
            safeLightTransfer(msg.sender, pending);
        }
        
        if (_amount > 0) {
            user.amount = user.amount - _amount;
            pool.lpToken.safeTransfer(address(msg.sender), _amount);
        }
        user.rewardDebt = user.amount * pool.accLightPerShare / 1e12;
        emit Withdraw(msg.sender, _pid, _amount);
    }

    /**
     * @dev Withdraw without caring about rewards. EMERGENCY ONLY.
     */
    function emergencyWithdraw(uint256 _pid) external nonReentrant {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        uint256 amount = user.amount;
        user.amount = 0;
        user.rewardDebt = 0;
        pool.lpToken.safeTransfer(address(msg.sender), amount);
        emit EmergencyWithdraw(msg.sender, _pid, amount);
    }

    // ==========================================
    // INTERNAL FUNCTIONS
    // ==========================================

    /**
     * @dev Safe light transfer function, just in case if rounding error causes pool to not have enough LIGHTs.
     */
    function safeLightTransfer(address _to, uint256 _amount) internal {
        uint256 lightBal = lightToken.balanceOf(address(this));
        bool success;
        if (_amount > lightBal) {
            success = lightToken.transfer(_to, lightBal);
        } else {
            success = lightToken.transfer(_to, _amount);
        }
        // We do not revert here if transfer fails, to prevent locking user funds if rewards pool is empty.
    }

    function getMultiplier(uint256 _from, uint256 _to) internal pure returns (uint256) {
        return (_to - _from) * BONUS_MULTIPLIER;
    }
}