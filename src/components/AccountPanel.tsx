import React from 'react';
import { useAccountPosition } from '../hooks/useAccountPosition';
import { useHealthFactor } from '../hooks/useHealthFactor';
import { toHuman } from '../lib/format';

interface Props {
  address?: `0x${string}`;
}

export const AccountPanel: React.FC<Props> = ({ address }) => {
  const { positions } = useAccountPosition(address);
  const { healthFactor, raw } = useHealthFactor(address);

  return (
    <div className="account-panel">
      <h3>Tu Cuenta</h3>
      <p>Address: {address || '—'}</p>
      <p>Health Factor (HF): {healthFactor === null ? '—' : healthFactor === Infinity ? '∞' : healthFactor.toFixed(4)}</p>
      {raw && (
        <div className="liq-box">
          <p>LiquidationUSD: {(Number(raw.liquidationUSD) / 1e18).toFixed(6)}</p>
          <p>BorrowUSD: {(Number(raw.borrowUSD) / 1e18).toFixed(6)}</p>
          <p>ShortfallUSD: {(Number(raw.shortfallUSD) / 1e18).toFixed(6)}</p>
        </div>
      )}
      <table>
        <thead>
          <tr>
            <th>cToken</th>
            <th>Supply (cTokens)</th>
            <th>Borrow (underlying)</th>
          </tr>
        </thead>
        <tbody>
          {positions.map(p => (
            <tr key={p.cToken}>
              <td>{p.cToken.slice(0,6)}…</td>
              <td>{toHuman(p.supplyCTokens, 18)}</td>
              <td>{toHuman(p.borrowUnderlying, p.underlyingDecimals)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};