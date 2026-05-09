# T5 Spec — Aggregation

## Objective
Combine all risk signals deterministically.

## Aggregation
1. Any BLOCKED => BLOCKED.
2. Else any HIGH => HIGH.
3. Else two or more MEDIUM => HIGH.
4. Else one MEDIUM => MEDIUM.
5. Else LOW.

The LLM must not calculate or override risk.
