# Parámetros de Riesgo (Testnet Limpia)

## Mercados
- cUSDC
  - Underlying: USDC (6 dec)
  - CF: 0.85
  - LT: 0.90
  - IRM: Jump (base 2%, slope1 18%, slope2 60%, kink 80%)
  - ReserveFactor: 10%

- cASTR
  - Underlying: ASTR (18 dec)
  - CF: 0.50
  - LT: 0.60
  - IRM: Jump (base 3%, slope1 30%, slope2 120%, kink 70%)
  - ReserveFactor: 20%

## Global
- closeFactor: 50%
- liquidationIncentive: 8–10% (1.08–1.10)
- Oracle: precios mock = 1e18

## Health Factor (definición actual)
HF = liquidationUSD / borrowUSD.
Puede bajar en liquidaciones parciales si incentive * LT > HF actual.

## Próximos Ajustes (si se requiere):
- Reducir LT o incentivo para hacer HF subir tras liquidaciones pequeñas.
- Consolidar definición de HF si se busca alinearla a UX estándar (collateralUSD/borrowUSD).