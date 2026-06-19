# transfer-risk-policy

## Intent

# Transfer Risk Policy

Implementar validación de riesgo en transferencias salientes de SOL y SPL tokens.

## Alcance

- Validar reputación de wallet destino usando heurísticas on-chain
- Detectar wallets con actividad sospechosa (mixers, rug pulls, phishing)
- Policy engine debe evaluar cada transferencia contra umbrales configurables
- Rechazar o requerir aprobación adicional según nivel de riesgo
- Integrar con el execution gateway existente en `back/guardrail/execution/`

## Criterios de éxito

- Transferencias a wallets conocidas/seguras pasan sin fricción
- Transferencias a wallets de alto riesgo se rechazan con motivo claro
- Transferencias a wallets de riesgo medio requieren confirmación del usuario
- Tiempo de evaluación < 500ms

## Approach

Implementation approach will be detailed in the technical design.
