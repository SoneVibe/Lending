import React from 'react';
import { useMarketData } from '../hooks/useMarketData';
import { toHuman } from '../lib/format';

interface Props {
  onAction: (action: string, cToken: `0x${string}`) => void;
}

export const MarketTable: React.FC<Props> = ({ onAction }) => {
  const { markets, loading, refresh } = useMarketData();

  return (
    <div className="market-table">
      <div className="header">
        <h2>Mercados</h2>
        <button onClick={refresh}>⟳</button>
      </div>
      {loading && <p>Cargando...</p>}
      <table>
        <thead>
          <tr>
            <th>Mercado</th>
            <th>Utilización</th>
            <th>Supply APY</th>
            <th>Borrow APY</th>
            <th>Total Supply (cTokens)</th>
            <th>Total Borrow (underlying)</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {markets.map(m => (
            <tr key={m.cToken}>
              <td>{m.symbol}</td>
              <td>{(Number(m.utilization) / 1e16).toFixed(2)}%</td>
              <td>{m.supplyAPY}</td>
              <td>{m.borrowAPY}</td>
              <td>{toHuman(m.totalSupply, 18)}</td>
              <td>{toHuman(m.totalBorrows, 18)}</td>
              <td style={{ display: 'flex', gap: '4px' }}>
                <button onClick={() => onAction('deposit', m.cToken)}>Deposit</button>
                <button onClick={() => onAction('withdraw', m.cToken)}>Withdraw</button>
                <button onClick={() => onAction('borrow', m.cToken)}>Borrow</button>
                <button onClick={() => onAction('repay', m.cToken)}>Repay</button>
                <button onClick={() => onAction('liquidate', m.cToken)}>Liquidate</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};