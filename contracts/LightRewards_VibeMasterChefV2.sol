// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

interface ILightToken is IERC20 {
    function mint(address to, uint256 amount) external;
    function MAX_SUPPLY() external view returns (uint256);
    function owner() external view returns (address);
    function transferOwnership(address newOwner) external;
}

/// @notice Optional secondary-reward hook (SushiSwap MasterChefV2 / PancakeSwap style dual farms).
interface IRewarder {
    function onLightReward(uint256 pid, address user, address recipient, uint256 lightAmount, uint256 newLpAmount)
        external;
}

interface IVibeFactory {
    function getPair(address tokenA, address tokenB) external view returns (address);
}

interface IVibePair {
    function token0() external view returns (address);
    function token1() external view returns (address);
}

/**
 * @title VibeMasterChefV2
 * @notice LP farming for VibeSwap on Soneium. Distributes LIGHT to LP stakers.
 *
 * Design (PancakeSwap MasterChef / SushiSwap MasterChefV2 lineage):
 *  - Time-based emissions (lightPerSecond) instead of per-block: robust on OP-Stack L2s.
 *  - Per-pool `totalStaked` accounting (immune to LP donations, allows a LIGHT single-stake pool).
 *  - Two reward modes, fixed at deploy:
 *      * MINT mode     -> chef owns LightToken and mints exactly what is emitted (clamped to MAX_SUPPLY).
 *                         Deploy note: transfer LIGHT ownership to the chef BEFORE add(); add() enforces it.
 *      * PREFUND mode  -> owner funds the chef with LIGHT. Accrual is capped at the funded, not-yet-owed
 *                         balance, so every LIGHT credited to stakers is always backed (LR-H-01 / LR-M-03).
 *                         endTime is mandatory and rate/time changes must be fully funded.
 *  - Global liability tracking (totalAccrued - totalPaid - totalForfeited): owed rewards can never be
 *    recovered or redirected by the owner (LR-H-01 / LR-M-01).
 *  - Hard cap on emission rate (immutable, itself bounded by ABSOLUTE_MAX_LIGHT_PER_SECOND).
 *  - LP allowlist: only VibeSwap factory pairs or LIGHT itself.
 *  - Optional per-pool IRewarder: set at add() or once later via setRewarder(); can only be cleared, never
 *    replaced. Every call is try/catch with a fixed gas stipend, so a broken rewarder can never block
 *    deposit/withdraw/harvest (LR-M-02).
 *  - Pause blocks only new deposits; withdraw / harvest / emergencyWithdraw always work. A pause-only
 *    `guardian` (set by the owner) can pause without delay; unpause stays with the owner.
 *  - `lockPools()` irreversibly disables add() (single-campaign lock).
 *  - Recommended owner: Safe multisig behind an OpenZeppelin TimelockController (>= 48h). Not enforced here.
 */
contract VibeMasterChefV2 is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using SafeERC20 for ILightToken;

    // ==========================================
    // STRUCTS
    // ==========================================

    struct UserInfo {
        uint256 amount; // LP tokens staked
        uint256 rewardDebt; // amount * accLightPerShare / ACC_PRECISION at last action
        uint256 unpaid; // rewards earned but not yet paid (rounding dust only, since accrual is backed)
    }

    struct PoolInfo {
        IERC20 lpToken;
        uint256 allocPoint;
        uint256 lastRewardTime;
        uint256 accLightPerShare; // scaled by ACC_PRECISION
        uint256 totalStaked;
        IRewarder rewarder;
    }

    // ==========================================
    // CONSTANTS / IMMUTABLES
    // ==========================================

    uint256 public constant ACC_PRECISION = 1e18;
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_TREASURY_BPS = 1_000; // 10%
    uint256 public constant MAX_POOLS = 100; // bounds massUpdatePools gas
    uint256 public constant MAX_ALLOC_POINT = 1_000_000; // per pool; bounds reward arithmetic
    /// @notice Absolute ceiling for maxLightPerSecond: 1 LIGHT/s (~31.5M LIGHT/yr, ~3.15% of MAX_SUPPLY).
    uint256 public constant ABSOLUTE_MAX_LIGHT_PER_SECOND = 1e18;
    /// @notice Gas forwarded to a rewarder hook. Rewarders needing more are unsupported.
    uint256 public constant REWARDER_GAS = 200_000;

    ILightToken public immutable light;
    address public immutable factory;
    bool public immutable mintRewards;
    uint256 public immutable maxLightPerSecond;

    // ==========================================
    // STATE
    // ==========================================

    uint256 public lightPerSecond;
    uint256 public startTime;
    uint256 public endTime; // 0 = open-ended (MINT mode only)
    uint256 public totalAllocPoint;

    address public treasury;
    uint256 public treasuryBps;

    /// @dev LIGHT held by the chef on behalf of stakers (pools whose lpToken == LIGHT). Never used for rewards.
    uint256 public totalLightStaked;

    /// @notice LIGHT credited to pools (sum of rewards added to accLightPerShare).
    uint256 public totalAccrued;
    /// @notice LIGHT actually paid to users.
    uint256 public totalPaid;
    /// @notice LIGHT owed to users who gave it up via emergencyWithdraw.
    uint256 public totalForfeited;

    /// @notice MINT mode: set once LIGHT ownership was handed back after the farm ended. Emissions are final.
    bool public emissionsFinalized;

    /// @notice Pause-only role (e.g. the Safe, no delay). Cannot unpause or change anything else.
    address public guardian;

    /// @notice One-way switch: once set, add() is disabled forever (single-campaign lock).
    bool public poolsLocked;

    PoolInfo[] public poolInfo;
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;
    mapping(IERC20 => bool) public poolExistence;
    /// @notice True once a pool has ever had a rewarder (via add() or setRewarder()). A pool gets at most one.
    mapping(uint256 => bool) public rewarderUsed;

    // ==========================================
    // EVENTS
    // ==========================================

    event Deposit(address indexed user, uint256 indexed pid, uint256 amount, address indexed to);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event Harvest(address indexed user, uint256 indexed pid, uint256 paid, uint256 unpaid);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event PoolAdded(uint256 indexed pid, IERC20 indexed lpToken, uint256 allocPoint, IRewarder rewarder);
    event PoolSet(uint256 indexed pid, uint256 allocPoint);
    event RewarderCleared(uint256 indexed pid, IRewarder oldRewarder);
    event RewarderSet(uint256 indexed pid, IRewarder rewarder);
    event UpdatePool(uint256 indexed pid, uint256 lastRewardTime, uint256 totalStaked, uint256 accLightPerShare);
    event LightPerSecondUpdated(uint256 oldRate, uint256 newRate);
    event StartTimeUpdated(uint256 startTime);
    event EndTimeUpdated(uint256 endTime);
    event TreasuryUpdated(address indexed treasury, uint256 bps);
    event TokenRecovered(address indexed token, address indexed to, uint256 amount);
    event RewarderFailed(uint256 indexed pid, address indexed user);
    event LightOwnershipReleased(address indexed newOwner);
    event GuardianUpdated(address indexed guardian);
    event PoolsLocked();

    // ==========================================
    // ERRORS
    // ==========================================

    error VibeInvalidPid();
    error VibePoolExists();
    error VibeTooManyPools();
    error VibeInvalidToken();
    error VibeRateTooHigh();
    error VibeInvalidTime();
    error VibeInvalidBps();
    error VibeZeroAddress();
    error VibeInsufficientStake();
    error VibeForbidden();
    error VibeUnderfunded();
    error VibeNotMinter();
    error VibeInvalidAlloc();
    error VibeLowGas();

    // ==========================================
    // CONSTRUCTOR
    // ==========================================

    constructor(
        ILightToken _light,
        address _factory,
        bool _mintRewards,
        uint256 _lightPerSecond,
        uint256 _maxLightPerSecond,
        uint256 _startTime,
        uint256 _endTime,
        address _owner
    ) Ownable(_owner) {
        if (address(_light) == address(0) || _factory == address(0)) revert VibeZeroAddress();
        if (_maxLightPerSecond > ABSOLUTE_MAX_LIGHT_PER_SECOND || _lightPerSecond > _maxLightPerSecond) {
            revert VibeRateTooHigh();
        }
        uint256 start = _startTime < block.timestamp ? block.timestamp : _startTime;
        if (_endTime != 0 && _endTime <= start) revert VibeInvalidTime();
        if (!_mintRewards && _endTime == 0) revert VibeInvalidTime(); // PREFUND must be bounded
        light = _light;
        factory = _factory;
        mintRewards = _mintRewards;
        lightPerSecond = _lightPerSecond;
        maxLightPerSecond = _maxLightPerSecond;
        startTime = start;
        endTime = _endTime;
        // PREFUND: fund the chef (see requiredFunding()) before add(); add() and every rate/time change
        // require the remaining schedule to be fully backed. Accrual is additionally capped at the backed
        // balance as a safety net, so credited rewards are always in the contract.
    }

    // ==========================================
    // MODIFIERS
    // ==========================================

    modifier validPid(uint256 pid) {
        if (pid >= poolInfo.length) revert VibeInvalidPid();
        _;
    }

    // ==========================================
    // ADMIN (owner should be a Safe behind a >= 48h TimelockController)
    // ==========================================

    /// @notice Ownership can only be transferred (2-step), never renounced.
    function renounceOwnership() public view override onlyOwner {
        revert VibeForbidden();
    }

    /// @notice Add a pool. lpToken must be a VibeSwap factory pair or LIGHT itself. Rewarder is fixed here.
    function add(uint256 allocPoint, IERC20 lpToken, IRewarder rewarder) external onlyOwner {
        if (poolsLocked) revert VibeForbidden();
        if (allocPoint > MAX_ALLOC_POINT) revert VibeInvalidAlloc();
        if (poolExistence[lpToken]) revert VibePoolExists();
        if (poolInfo.length >= MAX_POOLS) revert VibeTooManyPools();
        if (!_isAllowedLp(address(lpToken))) revert VibeInvalidToken();
        if (mintRewards && !mintReady()) revert VibeNotMinter(); // LR-L-01

        massUpdatePools();
        poolExistence[lpToken] = true;
        totalAllocPoint += allocPoint;
        poolInfo.push(
            PoolInfo({
                lpToken: lpToken,
                allocPoint: allocPoint,
                lastRewardTime: block.timestamp > startTime ? block.timestamp : startTime,
                accLightPerShare: 0,
                totalStaked: 0,
                rewarder: rewarder
            })
        );
        if (address(rewarder) != address(0)) rewarderUsed[poolInfo.length - 1] = true;
        emit PoolAdded(poolInfo.length - 1, lpToken, allocPoint, rewarder);
        _requireFunded(); // PREFUND: no pool can exist while the schedule is not fully backed
    }

    /// @notice Change a pool's allocation. The rewarder cannot be changed here (see setRewarder / clearRewarder).
    function set(uint256 pid, uint256 allocPoint) external onlyOwner validPid(pid) {
        if (allocPoint > MAX_ALLOC_POINT) revert VibeInvalidAlloc();
        massUpdatePools();
        PoolInfo storage pool = poolInfo[pid];
        totalAllocPoint = totalAllocPoint - pool.allocPoint + allocPoint;
        pool.allocPoint = allocPoint;
        emit PoolSet(pid, allocPoint);
    }

    /**
     * @notice Attach a rewarder ONCE to a pool that never had one (approved by Dennis).
     * @dev N-01: a rewarder added after staking began has no records for existing stakers. It must take stake
     *      amounts from chef.userInfo(pid, user).amount (pull model), e.g. a permissionless checkpoint(user) for
     *      existing stakers before it starts accruing, and must not trust only its own callback records.
     *      Hook calls stay try/catch + REWARDER_GAS cap + gas floor, so it can never block exits.
     */
    function setRewarder(uint256 pid, IRewarder rewarder) external onlyOwner validPid(pid) {
        if (address(rewarder) == address(0)) revert VibeZeroAddress();
        PoolInfo storage pool = poolInfo[pid];
        if (address(pool.rewarder) != address(0) || rewarderUsed[pid]) revert VibeForbidden();
        rewarderUsed[pid] = true;
        pool.rewarder = rewarder;
        emit RewarderSet(pid, rewarder);
    }

    /// @notice Emergency: detach a misbehaving rewarder. It can never be replaced by another one.
    function clearRewarder(uint256 pid) external onlyOwner validPid(pid) {
        PoolInfo storage pool = poolInfo[pid];
        emit RewarderCleared(pid, pool.rewarder);
        pool.rewarder = IRewarder(address(0));
    }

    function setLightPerSecond(uint256 newRate) external onlyOwner {
        if (newRate > maxLightPerSecond) revert VibeRateTooHigh();
        if (emissionsFinalized && newRate != 0) revert VibeForbidden();
        massUpdatePools();
        emit LightPerSecondUpdated(lightPerSecond, newRate);
        lightPerSecond = newRate;
        _requireFunded();
    }

    /// @notice Only before farming starts.
    function setStartTime(uint256 newStart) external onlyOwner {
        if (block.timestamp >= startTime || newStart <= block.timestamp) revert VibeInvalidTime();
        if (endTime != 0 && newStart >= endTime) revert VibeInvalidTime();
        startTime = newStart;
        uint256 len = poolInfo.length;
        for (uint256 pid; pid < len; ++pid) {
            poolInfo[pid].lastRewardTime = newStart;
        }
        emit StartTimeUpdated(newStart);
        _requireFunded();
    }

    /// @notice Must be in the future (cannot retroactively cut earned rewards). 0 = no end, MINT mode only.
    function setEndTime(uint256 newEnd) external onlyOwner {
        if (emissionsFinalized) revert VibeForbidden();
        // N-03: once an end time exists, the farm can never become open-ended again (MINT; PREFUND never allows 0),
        // so transferLightOwnership cannot be postponed forever via setEndTime(now + 1) then setEndTime(0).
        if (newEnd == 0 && endTime != 0) revert VibeInvalidTime();
        if (newEnd == 0 ? !mintRewards : (newEnd <= block.timestamp || newEnd <= startTime)) {
            revert VibeInvalidTime();
        }
        massUpdatePools();
        endTime = newEnd;
        emit EndTimeUpdated(newEnd);
        _requireFunded();
    }

    /// @notice Extra LIGHT minted to treasury on top of farm emissions (MINT mode only).
    function setTreasury(address newTreasury, uint256 bps) external onlyOwner {
        if (bps > MAX_TREASURY_BPS) revert VibeInvalidBps();
        if (bps != 0 && (newTreasury == address(0) || !mintRewards)) revert VibeInvalidBps();
        massUpdatePools();
        treasury = newTreasury;
        treasuryBps = bps;
        emit TreasuryUpdated(newTreasury, bps);
    }

    /// @notice Pauses new deposits only. Withdraw, harvest and emergencyWithdraw remain available.
    ///         Callable by the owner or the pause-only guardian. Unpause stays owner-only (timelock).
    function pause() external {
        if (msg.sender != owner() && msg.sender != guardian) revert VibeForbidden();
        _pause();
    }

    /// @notice Set (or clear with address(0)) the pause-only guardian.
    function setGuardian(address newGuardian) external onlyOwner {
        guardian = newGuardian;
        emit GuardianUpdated(newGuardian);
    }

    /// @notice Irreversibly disable add(). Call right after adding the campaign pool(s).
    function lockPools() external onlyOwner {
        poolsLocked = true;
        emit PoolsLocked();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Recover tokens sent by mistake. Staked LP tokens can never be taken.
     *         LIGHT: only the surplus above (staked LIGHT + owed rewards + remaining committed PREFUND emissions).
     */
    function recoverToken(IERC20 token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert VibeZeroAddress();
        if (address(token) == address(light)) {
            massUpdatePools();
            if (amount > recoverableLight()) revert VibeForbidden();
        } else if (poolExistence[token]) {
            revert VibeForbidden();
        }
        token.safeTransfer(to, amount);
        emit TokenRecovered(address(token), to, amount);
    }

    /**
     * @notice MINT mode only, after the farm has ended: hand LIGHT ownership to `newOwner` (e.g. a new chef or
     *         the timelock). All emissions up to endTime are minted first; emissions are then final.
     */
    function transferLightOwnership(address newOwner) external onlyOwner {
        if (!mintRewards || endTime == 0 || block.timestamp < endTime) revert VibeForbidden();
        if (newOwner == address(0)) revert VibeZeroAddress();
        massUpdatePools();
        emissionsFinalized = true;
        emit LightPerSecondUpdated(lightPerSecond, 0);
        lightPerSecond = 0;
        light.transferOwnership(newOwner);
        emit LightOwnershipReleased(newOwner);
    }

    // ==========================================
    // VIEWS
    // ==========================================

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    /// @notice LIGHT held for rewards (excludes staked LIGHT).
    function rewardBalance() public view returns (uint256) {
        uint256 bal = light.balanceOf(address(this));
        return bal > totalLightStaked ? bal - totalLightStaked : 0;
    }

    /// @notice LIGHT credited to stakers and not yet paid or forfeited (upper bound of what users can claim).
    function totalOwed() public view returns (uint256) {
        uint256 settled = totalPaid + totalForfeited;
        return totalAccrued > settled ? totalAccrued - settled : 0;
    }

    /// @notice Reward LIGHT not yet owed to anyone, including accruals not yet written by updatePool.
    function unbackedBalance() public view returns (uint256) {
        uint256 stored = _storedUnbacked();
        if (mintRewards) return stored;
        uint256 pending = _pendingAccrual();
        return stored > pending ? stored - pending : 0;
    }

    /// @notice PREFUND: LIGHT still to be emitted from max(now, startTime) to endTime at the current rate.
    function remainingEmissions() public view returns (uint256) {
        if (mintRewards || endTime == 0) return 0;
        uint256 from = block.timestamp > startTime ? block.timestamp : startTime;
        return endTime > from ? (endTime - from) * lightPerSecond : 0;
    }

    /// @notice PREFUND: extra LIGHT that must be sent so the whole schedule is backed (0 if fully funded).
    function requiredFunding() external view returns (uint256) {
        uint256 need = remainingEmissions();
        uint256 have = unbackedBalance();
        return need > have ? need - have : 0;
    }

    /// @notice LIGHT the owner may recover right now.
    function recoverableLight() public view returns (uint256) {
        uint256 have = unbackedBalance();
        uint256 committed = remainingEmissions();
        return have > committed ? have - committed : 0;
    }

    /// @notice PREFUND: timestamp until which the current schedule is fully backed (capped at endTime).
    ///         MINT: endTime (0 = open-ended). Conservative: periods with no stakers do not consume funds.
    function fundedUntil() external view returns (uint256) {
        if (mintRewards) return endTime;
        uint256 from = block.timestamp > startTime ? block.timestamp : startTime;
        if (lightPerSecond == 0 || from >= endTime) return endTime;
        uint256 t = from + unbackedBalance() / lightPerSecond;
        return t < endTime ? t : endTime;
    }

    /// @notice MINT mode deploy check: true when this chef owns the LIGHT token (required to mint).
    function mintReady() public view returns (bool) {
        return light.owner() == address(this);
    }

    /// @notice Current LIGHT/second going to a pool (for APR in the UI).
    function poolLightPerSecond(uint256 pid) external view validPid(pid) returns (uint256) {
        if (totalAllocPoint == 0) return 0;
        if (block.timestamp < startTime || (endTime != 0 && block.timestamp >= endTime)) return 0;
        return lightPerSecond * poolInfo[pid].allocPoint / totalAllocPoint;
    }

    function pendingLight(uint256 pid, address account) external view validPid(pid) returns (uint256) {
        PoolInfo memory pool = poolInfo[pid];
        UserInfo memory user = userInfo[pid][account];
        uint256 acc = pool.accLightPerShare;
        if (block.timestamp > pool.lastRewardTime && pool.totalStaked != 0) {
            (uint256 reward,) = _poolReward(pool);
            acc += reward * ACC_PRECISION / pool.totalStaked;
        }
        return user.amount * acc / ACC_PRECISION - user.rewardDebt + user.unpaid;
    }

    // ==========================================
    // POOL UPDATES
    // ==========================================

    function massUpdatePools() public {
        uint256 len = poolInfo.length;
        for (uint256 pid; pid < len; ++pid) {
            updatePool(pid);
        }
    }

    function updatePool(uint256 pid) public validPid(pid) {
        PoolInfo storage pool = poolInfo[pid];
        if (block.timestamp <= pool.lastRewardTime) return;

        uint256 supply = pool.totalStaked;
        if (supply != 0) {
            (uint256 reward, uint256 treasuryAmt) = _poolReward(pool);
            if (reward != 0) {
                if (mintRewards) {
                    light.mint(address(this), reward);
                    if (treasuryAmt != 0) light.mint(treasury, treasuryAmt);
                }
                totalAccrued += reward;
                pool.accLightPerShare += reward * ACC_PRECISION / supply;
            }
        }
        pool.lastRewardTime = block.timestamp;
        emit UpdatePool(pid, block.timestamp, supply, pool.accLightPerShare);
    }

    // ==========================================
    // USER ACTIONS
    // ==========================================

    /// @notice Stake LP. `deposit(pid, 0)` harvests (kept for frontend compatibility).
    function deposit(uint256 pid, uint256 amount) external nonReentrant {
        _deposit(pid, amount, msg.sender);
    }

    /// @notice Stake LP on behalf of `to` (for zaps). Zero-amount calls for someone else are rejected.
    function depositFor(uint256 pid, uint256 amount, address to) external nonReentrant {
        if (to == address(0)) revert VibeZeroAddress();
        if (amount == 0 && to != msg.sender) revert VibeForbidden();
        _deposit(pid, amount, to);
    }

    function withdraw(uint256 pid, uint256 amount) external nonReentrant validPid(pid) {
        PoolInfo storage pool = poolInfo[pid];
        UserInfo storage user = userInfo[pid][msg.sender];
        if (user.amount < amount) revert VibeInsufficientStake();

        updatePool(pid);
        uint256 paid = _harvest(pid, pool, user, msg.sender);

        if (amount != 0) {
            user.amount -= amount;
            pool.totalStaked -= amount;
            if (address(pool.lpToken) == address(light)) totalLightStaked -= amount;
        }
        user.rewardDebt = user.amount * pool.accLightPerShare / ACC_PRECISION;

        _callRewarder(pid, pool.rewarder, msg.sender, paid, user.amount);
        if (amount != 0) pool.lpToken.safeTransfer(msg.sender, amount);
        emit Withdraw(msg.sender, pid, amount);
    }

    function harvest(uint256 pid) external nonReentrant validPid(pid) {
        _harvestOnly(pid);
    }

    function harvestMany(uint256[] calldata pids) external nonReentrant {
        for (uint256 i; i < pids.length; ++i) {
            if (pids[i] >= poolInfo.length) revert VibeInvalidPid();
            _harvestOnly(pids[i]);
        }
    }

    /// @notice Withdraw LP without rewards (owed LIGHT is forfeited). Always available, even when paused.
    function emergencyWithdraw(uint256 pid) external nonReentrant validPid(pid) {
        PoolInfo storage pool = poolInfo[pid];
        UserInfo storage user = userInfo[pid][msg.sender];
        uint256 amount = user.amount;

        totalForfeited += amount * pool.accLightPerShare / ACC_PRECISION - user.rewardDebt + user.unpaid;
        user.amount = 0;
        user.rewardDebt = 0;
        user.unpaid = 0;
        pool.totalStaked -= amount;
        if (address(pool.lpToken) == address(light)) totalLightStaked -= amount;

        // N-01: same gas floor as other paths. Cannot trap principal: the hook is capped at REWARDER_GAS and
        // failures are caught, so ~REWARDER_GAS + ~100k always suffices; it only stops self-starving the hook.
        _callRewarder(pid, pool.rewarder, msg.sender, 0, 0);
        pool.lpToken.safeTransfer(msg.sender, amount);
        emit EmergencyWithdraw(msg.sender, pid, amount);
    }

    // ==========================================
    // INTERNAL
    // ==========================================

    function _deposit(uint256 pid, uint256 amount, address account) internal validPid(pid) {
        if (amount != 0) _requireNotPaused();
        PoolInfo storage pool = poolInfo[pid];
        UserInfo storage user = userInfo[pid][account];

        updatePool(pid);
        uint256 paid = _harvest(pid, pool, user, account);

        uint256 received;
        if (amount != 0) {
            uint256 before = pool.lpToken.balanceOf(address(this));
            pool.lpToken.safeTransferFrom(msg.sender, address(this), amount);
            received = pool.lpToken.balanceOf(address(this)) - before; // fee-on-transfer safe
            user.amount += received;
            pool.totalStaked += received;
            if (address(pool.lpToken) == address(light)) totalLightStaked += received;
        }
        user.rewardDebt = user.amount * pool.accLightPerShare / ACC_PRECISION;

        _callRewarder(pid, pool.rewarder, account, paid, user.amount);
        emit Deposit(msg.sender, pid, received, account);
    }

    function _harvestOnly(uint256 pid) internal {
        PoolInfo storage pool = poolInfo[pid];
        UserInfo storage user = userInfo[pid][msg.sender];
        updatePool(pid);
        uint256 paid = _harvest(pid, pool, user, msg.sender);
        user.rewardDebt = user.amount * pool.accLightPerShare / ACC_PRECISION;
        _callRewarder(pid, pool.rewarder, msg.sender, paid, user.amount);
    }

    /// @dev Pays accrued + previously unpaid LIGHT. Caller must reset rewardDebt afterwards.
    function _harvest(uint256 pid, PoolInfo storage pool, UserInfo storage user, address to)
        internal
        returns (uint256 paid)
    {
        uint256 owed = user.amount * pool.accLightPerShare / ACC_PRECISION - user.rewardDebt + user.unpaid;
        if (owed == 0) return 0;

        uint256 available = rewardBalance();
        paid = owed > available ? available : owed;
        user.unpaid = owed - paid;
        if (paid != 0) {
            totalPaid += paid;
            light.safeTransfer(to, paid);
        }
        emit Harvest(to, pid, paid, user.unpaid);
    }

    /// @dev Rewarder hook with a fixed gas stipend; failures are logged, never bubbled (LR-M-02).
    ///      The caller must supply enough gas for the full stipend, so the hook cannot be starved on purpose.
    function _callRewarder(uint256 pid, IRewarder rewarder, address user, uint256 paid, uint256 newAmount) internal {
        if (address(rewarder) == address(0)) return;
        if (gasleft() < REWARDER_GAS * 64 / 63 + 5_000) revert VibeLowGas();
        try rewarder.onLightReward{gas: REWARDER_GAS}(pid, user, user, paid, newAmount) {}
        catch {
            emit RewarderFailed(pid, user);
        }
    }

    function _isAllowedLp(address lp) internal view returns (bool) {
        if (lp == address(light)) return true;
        if (lp.code.length == 0) return false;
        try IVibePair(lp).token0() returns (address t0) {
            try IVibePair(lp).token1() returns (address t1) {
                return IVibeFactory(factory).getPair(t0, t1) == lp;
            } catch {
                return false;
            }
        } catch {
            return false;
        }
    }

    /// @dev Reward LIGHT not owed as of the last pool updates (exact right after massUpdatePools).
    function _storedUnbacked() internal view returns (uint256) {
        uint256 rb = rewardBalance();
        uint256 owed = totalOwed();
        return rb > owed ? rb - owed : 0;
    }

    /// @dev PREFUND views: LIGHT that pools with stakers have earned since their last update (uncapped).
    function _pendingAccrual() internal view returns (uint256 sum) {
        if (totalAllocPoint == 0) return 0;
        uint256 to = endTime != 0 && block.timestamp > endTime ? endTime : block.timestamp;
        uint256 len = poolInfo.length;
        for (uint256 pid; pid < len; ++pid) {
            PoolInfo storage pool = poolInfo[pid];
            if (pool.totalStaked == 0 || to <= pool.lastRewardTime) continue;
            sum += (to - pool.lastRewardTime) * lightPerSecond * pool.allocPoint / totalAllocPoint;
        }
    }

    /// @dev PREFUND: every LIGHT still scheduled must already sit in the chef, unowed (LR-M-03).
    function _requireFunded() internal view {
        if (!mintRewards && remainingEmissions() > _storedUnbacked()) revert VibeUnderfunded();
    }

    /// @dev Reward accrued by `pool` since lastRewardTime, clamped to [startTime, endTime], to the backed
    ///      balance (PREFUND) and to MAX_SUPPLY (MINT).
    function _poolReward(PoolInfo memory pool) internal view returns (uint256 reward, uint256 treasuryAmt) {
        if (totalAllocPoint == 0 || pool.allocPoint == 0) return (0, 0);

        uint256 from = pool.lastRewardTime;
        uint256 to = block.timestamp;
        if (endTime != 0 && to > endTime) to = endTime;
        if (to <= from) return (0, 0);

        reward = (to - from) * lightPerSecond * pool.allocPoint / totalAllocPoint;

        if (mintRewards) {
            treasuryAmt = reward * treasuryBps / BPS;
            uint256 maxSupply = light.MAX_SUPPLY();
            uint256 lightSupply = light.totalSupply();
            uint256 mintable = maxSupply > lightSupply ? maxSupply - lightSupply : 0;
            if (reward + treasuryAmt > mintable) {
                reward = mintable * BPS / (BPS + treasuryBps);
                treasuryAmt = reward * treasuryBps / BPS;
            }
        } else {
            uint256 backed = _storedUnbacked();
            if (reward > backed) reward = backed; // never credit LIGHT that is not in the contract
        }
    }
}
