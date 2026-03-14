// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

contract V_Timelock {
    event QueueTransaction(bytes32 txHash, address target, uint256 value, string signature, bytes data, uint256 eta);
    event ExecuteTransaction(bytes32 txHash, address target, uint256 value, string signature, bytes data);
    event CancelTransaction(bytes32 txHash);

    uint256 public constant GRACE_PERIOD = 7 days;
    uint256 public delay; // ej: 2 days
    address public admin;
    address public pendingAdmin;

    mapping(bytes32 => bool) public queued;

    modifier onlyAdmin() { require(msg.sender == admin, "timelock: !admin"); _; }

    constructor(address _admin, uint256 _delay) {
        require(_delay >= 2 days && _delay <= 30 days, "bad delay");
        admin = _admin;
        delay = _delay;
    }

    function queueTransaction(
        address target,
        uint256 value,
        string memory signature,
        bytes memory data,
        uint256 eta
    ) external onlyAdmin returns (bytes32 txHash) {
        require(eta >= block.timestamp + delay, "eta too soon");
        txHash = keccak256(abi.encode(target, value, signature, data, eta));
        queued[txHash] = true;
        emit QueueTransaction(txHash, target, value, signature, data, eta);
    }

    function executeTransaction(
        address target,
        uint256 value,
        string memory signature,
        bytes memory data,
        uint256 eta
    ) external payable onlyAdmin returns (bytes memory) {
        bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
        require(queued[txHash], "not queued");
        require(block.timestamp >= eta, "too early");
        require(block.timestamp <= eta + GRACE_PERIOD, "stale");

        queued[txHash] = false;

        bytes memory callData = bytes(signature).length == 0
            ? data
            : abi.encodePacked(bytes4(keccak256(bytes(signature))), data);

        (bool ok, bytes memory res) = target.call{value:value}(callData);
        require(ok, "exec failed");
        emit ExecuteTransaction(txHash, target, value, signature, data);
        return res;
    }

    function cancelTransaction(bytes32 txHash) external onlyAdmin {
        require(queued[txHash], "not queued");
        queued[txHash] = false;
        emit CancelTransaction(txHash);
    }

    function setPendingAdmin(address pa) external onlyAdmin {
        pendingAdmin = pa;
    }

    function acceptAdmin() external {
        require(msg.sender == pendingAdmin, "not pending");
        admin = pendingAdmin;
        pendingAdmin = address(0);
    }
}