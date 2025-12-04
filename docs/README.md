# Frontend Lending (tipo Aave)

## Script rápido
1. Configura .env.local con direcciones.
2. Completa ABIs en `src/abis/`.
3. Ejecuta: `npm install` y luego `npm run dev`.

## Flujo de usuario
- Home: tabla de mercados (colateral factor (CF), LT, supply APY, borrow APY, liquidez).
- Modales: depositar (mint), retirar (redeem), pedir prestado (borrow), repagar (repay), liquidar (liquidate).
- Panel lateral: posición del usuario, HF, detalle por mercado.

## Cálculos Clave

### Utilización
U = borrows / (cash + borrows - reserves)

### Supply APY (aprox)
supplyRateAnnual = supplyRatePerBlock * blocksPerYear

### Borrow APY (aprox)
borrowRateAnnual = borrowRatePerBlock * blocksPerYear

### Exchange Rate (ya en contrato)
exchangeRateStored() → (cashNorm + borNorm - resNorm) * 1e18 / totalSupply

### Health Factor (HF)
HF = liquidationUSD / borrowUSD

liquidationUSD = Σ (valorColateral_i * LT_i)
borrowUSD = Σ valorDeuda_j

valorColateral_i = balanceUnderlying_i * price_i * (10^(18 - underlyingDecimals)) / 1e18  (ajustar si decimales > 18)
valorDeuda_i similar.

HF < 1 ⇒ riesgo de liquidación (según tus reglas).

### Liquidación expected seize
SeizeUSD = repayUSD * liquidationIncentive
SeizeTokens calculado por `_computeSeizeCTokens`.

## Extensiones futuras
- Historial de transacciones (subgraph / event index).
- Panel de riesgo global (promedio HF, mercados saturados).
- Filtro / búsqueda.

## Seguridad (frontend)
- Pre-chequear allowance antes de mint/repay.
- Mostrar advertencia si HF < 1.05
- Usar try/catch y parse revert reason.
