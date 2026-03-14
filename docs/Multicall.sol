// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title Multicall
 * @dev Agrega múltiples llamadas en una sola transacción para el Frontend.
 *      Versión actualizada para Solidity 0.8.30 (Paris/Cancun EVM).
 */
contract Multicall {
    struct Call {
        address target;
        bytes callData;
    }

    struct Return {
        bool success;
        bytes data;
    }

    // Función principal para llamar desde el Frontend
    function aggregate(Call[] memory calls) public returns (uint256 blockNumber, bytes[] memory returnData) {
        blockNumber = block.number;
        returnData = new bytes[](calls.length);
        for(uint256 i = 0; i < calls.length; i++) {
            (bool success, bytes memory ret) = calls[i].target.call(calls[i].callData);
            require(success, "Multicall aggregate: call failed");
            returnData[i] = ret;
        }
    }

    // Versión que no falla si una llamada individual falla (Try/Catch interno)
    function tryAggregate(bool requireSuccess, Call[] memory calls) public returns (Return[] memory returnData) {
        returnData = new Return[](calls.length);
        for(uint256 i = 0; i < calls.length; i++) {
            (bool success, bytes memory ret) = calls[i].target.call(calls[i].callData);

            if (requireSuccess) {
                require(success, "Multicall tryAggregate: call failed");
            }

            returnData[i] = Return(success, ret);
        }
    }

    // Helper functions (Consultas rápidas del estado de la cadena)
    function getEthBalance(address addr) public view returns (uint256 balance) {
        balance = addr.balance;
    }
    function getBlockHash(uint256 blockNumber) public view returns (bytes32 blockHash) {
        blockHash = blockhash(blockNumber);
    }
    function getLastBlockHash() public view returns (bytes32 blockHash) {
        blockHash = blockhash(block.number - 1);
    }
    function getCurrentBlockTimestamp() public view returns (uint256 timestamp) {
        timestamp = block.timestamp;
    }
    
    // CORRECCIÓN AQUÍ: Reemplazamos difficulty por prevrandao
    function getCurrentBlockPrevrandao() public view returns (uint256 prevrandao) {
        prevrandao = block.prevrandao;
    }

    function getCurrentBlockCoinbase() public view returns (address coinbase) {
        coinbase = block.coinbase;
    }
}