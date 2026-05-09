# T7 Spec — App wiring and history

## Objective
Wire async provider risk assessment into the existing intent flow and signing flow.

## Requirements
Initial assessment runs after parsing/preview. Transfer prepare builds the transaction, simulates it, updates assessment, and only then calls sendTransaction if not BLOCKED. Receipt data is fetched after confirmation and stored in history metadata.
