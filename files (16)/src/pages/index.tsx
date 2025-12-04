import React, { useState } from 'react';
import { MarketTable } from '../components/MarketTable';
import { AccountPanel } from '../components/AccountPanel';
import { ActionModal } from '../components/ActionModal';
import { useUserStore } from '../state/useUserStore';

export default function Home() {
  const { address, setAddress } = useUserStore();
  const [modalAction, setModalAction] = useState<'deposit'|'withdraw'|'borrow'|'repay'|'liquidate'|null>(null);
  const [modalCToken, setModalCToken] = useState<`0x${string}`|undefined>(undefined);

  function onAction(action: string, cToken: `0x${string}`) {
    setModalAction(action as any);
    setModalCToken(cToken);
  }

  return (
    <div className="layout">
      <header>
        <h1>Protocolo Lending</h1>
        <div className="wallet-box">
          <input
            placeholder="Tu Address 0x..."
            value={address || ''}
            onChange={e => setAddress(e.target.value as `0x${string}`)}
          />
        </div>
      </header>
      <main>
        <div className="left">
          <MarketTable onAction={onAction} />
        </div>
        <div className="right">
          <AccountPanel address={address} />
        </div>
      </main>
      {modalAction && modalCToken && (
        <ActionModal
          open={!!modalAction}
          action={modalAction}
          cToken={modalCToken}
          user={address}
          onClose={() => setModalAction(null)}
        />
      )}
      <style jsx>{`
        .layout { min-height:100vh; background:#0d0f11; color:#fff; }
        header { display:flex; justify-content:space-between; padding:16px 32px; align-items:center; background:#14181d; }
        main { display:flex; gap:24px; padding:24px; }
        .left { flex:2; }
        .right { flex:1; }
        table { width:100%; border-collapse:collapse; }
        th, td { padding:8px; border-bottom:1px solid #1f262c; font-size:14px; }
        th { text-align:left; }
        button { background:#2d3748; border:none; color:#fff; padding:4px 8px; border-radius:6px; cursor:pointer; }
        button:hover { background:#4a5568; }
        input { background:#1e1e1e; border:1px solid #333; color:#fff; padding:6px 10px; border-radius:8px; width:240px; }
        h1 { font-size:20px; }
      `}</style>
    </div>
  );
}