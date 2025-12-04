import React, { useState } from 'react';
import { useWriteContract, usePublicClient } from 'wagmi';
import { CTokenAbi } from '../lib/abis';
import { CTOKENS } from '../lib/constants';

interface Props {
  open: boolean;
  onClose: () => void;
  action: 'deposit' | 'withdraw' | 'borrow' | 'repay' | 'liquidate';
  cToken?: `0x${string}`;
  user?: `0x${string}`;
}

export const ActionModal: React.FC<Props> = ({ open, onClose, action, cToken, user }) => {
  const [amount, setAmount] = useState('');
  const { writeContract, isPending } = useWriteContract();
  const client = usePublicClient();

  if (!open || !cToken) return null;
  const market = CTOKENS.find(m => m.address === cToken);
  const decimals = market?.decimalsUnderlying || 18;

  async function submit() {
    if (!amount || !market) return;
    const raw = BigInt(Math.floor(Number(amount) * 10 ** decimals));
    try {
      if (action === 'deposit') {
        await writeContract({ address: cToken, abi: CTokenAbi.abi, functionName: 'mint', args: [raw] });
      } else if (action === 'withdraw') {
        // amount interpretado como cTokens aquí (podrías añadir toggle)
        await writeContract({ address: cToken, abi: CTokenAbi.abi, functionName: 'redeem', args: [raw] });
      } else if (action === 'borrow') {
        await writeContract({ address: cToken, abi: CTokenAbi.abi, functionName: 'borrow', args: [raw] });
      } else if (action === 'repay') {
        await writeContract({ address: cToken, abi: CTokenAbi.abi, functionName: 'repay', args: [raw] });
      } else if (action === 'liquidate') {
        // Para demo: liquidar tu propia cuenta no procede. Debe pedir borrower y cTokenCollateral.
        // Puedes expandir con inputs adicionales.
        alert('Expandir UI para liquidar a otro borrower.');
      }
      onClose();
    } catch (e: any) {
      console.error(e);
      alert(e.shortMessage || e.message);
    }
  }

  return (
    <div className="modal">
      <div className="card">
        <h3>{action.toUpperCase()} {market?.underlying}</h3>
        <input
          placeholder={`Cantidad (${action === 'withdraw' ? 'cTokens' : market?.underlying})`}
          value={amount}
          onChange={e => setAmount(e.target.value)}
        />
        <div className="row">
          <button disabled={isPending} onClick={submit}>{isPending ? 'Enviando...' : 'Confirmar'}</button>
          <button onClick={onClose}>Cerrar</button>
        </div>
      </div>
      <style jsx>{`
        .modal {
          position: fixed; top:0; left:0; right:0; bottom:0;
          background: rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center;
        }
        .card {
          background:#121212; padding:20px; border-radius:12px; width:360px;
          display:flex; flex-direction:column; gap:12px;
        }
        input {
          background:#1e1e1e; border:1px solid #333; color:#fff; padding:8px; border-radius:8px;
        }
        button {
          background:#3b82f6; color:#fff; border:none; padding:8px 12px; border-radius:8px; cursor:pointer;
        }
        .row { display:flex; gap:8px; }
      `}</style>
    </div>
  );
};