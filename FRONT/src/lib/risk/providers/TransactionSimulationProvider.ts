import type {
  RiskProvider,
  RiskProviderInput,
  RiskProviderResult,
  RiskReason,
  SimulationRiskData,
} from '../../types';

type SimulatableConnection = {
  simulateTransaction: (transaction: unknown) => Promise<{
    value: {
      err: unknown;
      logs?: string[] | null;
      accounts?: unknown[] | null;
    };
  }>;
};

/** Transaction simulation provider - simulates prepared transactions before signing. */
export class TransactionSimulationProvider implements RiskProvider {
  readonly name = 'TransactionSimulation';
  readonly source = 'Solana RPC simulateTransaction';

  async assess(input: RiskProviderInput): Promise<RiskProviderResult> {
    if (!input.preparedTransaction) {
      return {
        provider: this.name,
        status: 'success',
        signals: [{
          ...this.signal('Simulation Not Yet Run', 'not_prepared', 'N/A', 'LOW', 'Transaction has not been prepared yet. Simulation will run before signing.'),
          checkName: 'simulation_status',
        }],
      };
    }

    if (!this.isSimulatableConnection(input.connection)) {
      return {
        provider: this.name,
        status: 'unavailable',
        signals: [this.signal('Cannot Simulate', false, 'Connection required', 'HIGH', 'Transaction simulation requires an RPC connection.')],
      };
    }

    const result = await this.simulateTransaction(input.preparedTransaction, input.connection);

    if (!result.success) {
      return {
        provider: this.name,
        status: 'success',
        signals: [{
          ...this.signal('Simulation Failed', false, 'Must succeed', 'BLOCKED', 'The transaction was simulated before signing and failed. Failed simulations are blocked.'),
          detail: `Transaction simulation failed: ${result.error ?? 'Unknown error'}`,
          metadata: { error: result.error, logs: result.logs },
        }],
      };
    }

    return {
      provider: this.name,
      status: 'success',
      signals: [this.signal('Simulation Successful', true, 'Success', 'LOW', 'The transaction was simulated before signing and is expected to succeed.')],
      rawData: result,
    };
  }

  private isSimulatableConnection(connection: unknown): connection is SimulatableConnection {
    return typeof connection === 'object'
      && connection !== null
      && 'simulateTransaction' in connection
      && typeof (connection as SimulatableConnection).simulateTransaction === 'function';
  }

  private async simulateTransaction(
    transaction: unknown,
    connection: SimulatableConnection,
  ): Promise<SimulationRiskData> {
    try {
      const result = await connection.simulateTransaction(transaction);

      if (result.value.err) {
        return {
          success: false,
          error: JSON.stringify(result.value.err),
          logs: result.value.logs ?? [],
        };
      }

      return {
        success: true,
        logs: result.value.logs ?? [],
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private signal(
    label: string,
    value: string | number | boolean,
    threshold: string,
    severity: RiskReason['severity'],
    explanation: string,
  ): RiskReason {
    return {
      label,
      detail: explanation,
      severity,
      checkName: 'transaction_simulation',
      source: this.source,
      value,
      threshold,
      riskImpact: severity,
      explanation,
    };
  }
}
