import { useState, useCallback } from 'react';
import type { FC } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useConnection } from '@solana/wallet-adapter-react';
import Header from '@/components/Header';
import LandingHero from '@/components/LandingHero';
import IntentInput from '@/components/IntentInput';
import ParsedIntentPanel from '@/components/ParsedIntentPanel';
import TransactionPreviewPanel from '@/components/TransactionPreviewPanel';
import SafetyReviewPanel from '@/components/SafetyReviewPanel';
import ConfirmationSection from '@/components/ConfirmationSection';
import HistoryPanel from '@/components/HistoryPanel';

import type {
  ParsedIntent,
  ParseError,
  RiskAssessment,
  TransactionPreview,
  TransactionStatus,
  AppFlowState,
} from '@/lib/types';
import { parseIntent } from '@/lib/intentParser';
import { assessRisk } from '@/lib/riskEngine';
import { getSwapQuote, getTransferPreview } from '@/lib/quoteProvider';
import { saveHistoryEntry, generateId } from '@/lib/history';
import {
  buildTransferTransaction,
  buildSwapTransaction,
  confirmTransaction,
  checkBalance,
} from '@/lib/transactionBuilder';
import { HeliusReceiptProvider } from '@/lib/risk/providers/HeliusReceiptProvider';

const Index: FC = () => {
  const { connected, publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [showHistory, setShowHistory] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);

  // Flow state
  const [flowState, setFlowState] = useState<AppFlowState>('idle');
  const [parsedIntent, setParsedIntent] = useState<ParsedIntent | undefined>();
  const [parseError, setParseError] = useState<ParseError | undefined>();
  const [txPreview, setTxPreview] = useState<TransactionPreview | undefined>();
  const [riskAssessment, setRiskAssessment] = useState<RiskAssessment | undefined>();
  const [txStatus, setTxStatus] = useState<TransactionStatus>('pending');
  const [txSignature, setTxSignature] = useState<string | undefined>();
  const [currentEntryId, setCurrentEntryId] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();

  const resetFlow = useCallback(() => {
    setFlowState('idle');
    setParsedIntent(undefined);
    setParseError(undefined);
    setTxPreview(undefined);
    setRiskAssessment(undefined);
    setTxStatus('pending');
    setTxSignature(undefined);
    setCurrentEntryId(undefined);
    setTxError(undefined);
  }, []);

  const updateHistoryStatus = useCallback(
    (entryId: string, status: string, sig?: string) => {
      try {
        const history = JSON.parse(
          localStorage.getItem('intent-wallet-copilot-history') || '[]',
        );
        const idx = history.findIndex((e: { id: string }) => e.id === entryId);
        if (idx !== -1) {
          history[idx].status = status;
          if (sig) history[idx].txSignature = sig;
          localStorage.setItem(
            'intent-wallet-copilot-history',
            JSON.stringify(history),
          );
        }
      } catch {
        // localStorage write failure is non-critical
      }
      setHistoryRefresh((prev) => prev + 1);
    },
    [],
  );

  const handleIntentSubmit = useCallback(
    (text: string) => {
      resetFlow();
      setFlowState('parsing');

      setTimeout(async () => {
        const result = parseIntent(text);

        if (result.ok === false) {
          setParseError(result.error);
          setFlowState('error');

          const entryId = generateId();
          saveHistoryEntry({
            id: entryId,
            timestamp: Date.now(),
            originalText: text,
            action: 'swap',
            riskLevel: 'BLOCKED',
            status: 'failed',
            details: result.error.message,
          });
          setHistoryRefresh((prev) => prev + 1);
          return;
        }

        const intent = result.intent;
        setParsedIntent(intent);
        setFlowState('parsed');

        let preview: TransactionPreview;
        if (intent.action === 'swap') {
          const quote = getSwapQuote(intent);
          preview = { type: 'swap', quote, intent };
        } else {
          const tp = getTransferPreview(
            intent,
            publicKey?.toBase58() || 'Not connected',
          );
          preview = { type: 'transfer', preview: tp, intent };
        }
        setTxPreview(preview);

        const risk = await assessRisk(
          intent,
          preview.type === 'swap' ? preview.quote : undefined,
          undefined,
          connection,
          publicKey?.toBase58(),
        );
        setRiskAssessment(risk);
        setFlowState('reviewing');

        const entryId = generateId();
        setCurrentEntryId(entryId);
        saveHistoryEntry({
          id: entryId,
          timestamp: Date.now(),
          originalText: text,
          action: intent.action,
          riskLevel: risk.level,
          status: risk.level === 'BLOCKED' ? 'failed' : 'pending',
          details:
            intent.action === 'swap'
              ? `${intent.amount} ${intent.inputToken} → ${intent.outputToken}`
              : `${intent.amount} ${intent.token} → ${intent.recipient.slice(0, 8)}...`,
        });
        setHistoryRefresh((prev) => prev + 1);
      }, 400);
    },
    [connection, publicKey, resetFlow],
  );

  const handlePrepare = useCallback(async () => {
    if (!publicKey || !parsedIntent || !sendTransaction) return;

    setTxStatus('signing');
    setFlowState('signing');
    setTxError(undefined);

    try {
      if (parsedIntent.action === 'transfer') {
        // ------- REAL TRANSFER -------
        // 1. Check balance
        const { sufficient, balance } = await checkBalance(
          connection,
          publicKey,
          parsedIntent.token,
          parsedIntent.amount,
        );

        if (!sufficient) {
          const msg = `Insufficient ${parsedIntent.token} balance. You have ${balance.toFixed(4)} but need ${parsedIntent.amount}.`;
          setTxError(msg);
          setTxStatus('failed');
          setFlowState('error');
          if (currentEntryId) updateHistoryStatus(currentEntryId, 'failed');
          return;
        }

        // 2. Build transaction
        const tx = await buildTransferTransaction(
          connection,
          publicKey,
          parsedIntent,
        );

        // 3. Simulate transaction before signing
        const simulatedRisk = await assessRisk(
          parsedIntent,
          undefined,
          tx,
          connection,
          publicKey.toBase58(),
        );

        // Update risk assessment with simulation results
        setRiskAssessment(simulatedRisk);

        // Block if simulation failed
        if (simulatedRisk.level === 'BLOCKED') {
          setTxError(
            'Transaction simulation failed. This transaction would fail on-chain. Please check the safety review for details.',
          );
          setTxStatus('failed');
          setFlowState('error');
          if (currentEntryId) updateHistoryStatus(currentEntryId, 'failed');
          return;
        }

        // 4. Send via wallet adapter (user signs in their wallet)
        const signature = await sendTransaction(tx, connection);

        setTxSignature(signature);
        setTxStatus('submitted');

        // 5. Wait for confirmation
        const confirmed = await confirmTransaction(
          connection,
          signature,
          tx.recentBlockhash,
          tx.lastValidBlockHeight,
        );

        if (confirmed) {
          setTxStatus('confirmed');
          setFlowState('success');
          
          // 6. Fetch transaction receipt
          try {
            const receiptProvider = new HeliusReceiptProvider();
            const receipt = await receiptProvider.fetchReceipt(signature);
            
            // Update history with receipt
            const history = JSON.parse(
              localStorage.getItem('intent-wallet-copilot-history') || '[]',
            );
            const idx = history.findIndex((e: { id: string }) => e.id === currentEntryId);
            if (idx !== -1) {
              history[idx].status = 'confirmed';
              history[idx].txSignature = signature;
              history[idx].receipt = receipt;
              localStorage.setItem(
                'intent-wallet-copilot-history',
                JSON.stringify(history),
              );
            }
          } catch (receiptError) {
            // Receipt fetch failure is non-critical
            console.warn('Failed to fetch receipt:', receiptError);
          }
          
          if (currentEntryId)
            updateHistoryStatus(currentEntryId, 'confirmed', signature);
        } else {
          setTxError(
            'Transaction was submitted but could not be confirmed. Check Solana Explorer for status.',
          );
          setTxStatus('failed');
          setFlowState('error');
          if (currentEntryId)
            updateHistoryStatus(currentEntryId, 'failed', signature);
        }
      } else {
        // ------- SWAP (demo mode until Jupiter is wired) -------
        const swapTx = await buildSwapTransaction(
          connection,
          publicKey,
          parsedIntent,
        );

        if (!swapTx) {
          // Demo mode: simulate the signing flow
          await new Promise((resolve) => setTimeout(resolve, 1500));
          const demoSig = `demo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
          setTxSignature(demoSig);
          setTxStatus('confirmed');
          setFlowState('success');
          if (currentEntryId)
            updateHistoryStatus(currentEntryId, 'confirmed', demoSig);
          return;
        }
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Transaction was rejected or failed.';

      // User rejected in wallet
      if (message.includes('User rejected') || message.includes('rejected')) {
        setTxError('Transaction was cancelled in your wallet.');
        setTxStatus('cancelled');
      } else {
        setTxError(message);
        setTxStatus('failed');
      }
      setFlowState('error');
      if (currentEntryId) updateHistoryStatus(currentEntryId, 'failed');
    }
  }, [
    publicKey,
    parsedIntent,
    sendTransaction,
    connection,
    currentEntryId,
    updateHistoryStatus,
  ]);

  // Show landing if wallet not connected
  if (!connected) {
    return (
      <div className="min-h-screen bg-background">
        <Header showHistory={false} onToggleHistory={() => {}} />
        <LandingHero />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header
        showHistory={showHistory}
        onToggleHistory={() => setShowHistory(!showHistory)}
      />

      <main className="container py-6 pb-20">
        {showHistory ? (
          <div className="max-w-2xl mx-auto">
            <HistoryPanel refreshKey={historyRefresh} />
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-5">
            {/* Wallet status */}
            <div className="flex items-center gap-2 rounded-md bg-surface-1 border border-border px-3 py-2">
              <div className="h-2 w-2 rounded-full bg-risk-low" />
              <span className="text-xs text-muted-foreground">Connected:</span>
              <span className="text-xs font-mono text-foreground">
                {publicKey?.toBase58().slice(0, 6)}...
                {publicKey?.toBase58().slice(-4)}
              </span>
              <span className="ml-auto text-xs text-muted-foreground/60">
                Devnet
              </span>
            </div>

            {/* Intent input */}
            <IntentInput
              onSubmit={handleIntentSubmit}
              isProcessing={flowState === 'parsing'}
              disabled={flowState === 'signing'}
            />

            {/* Parse error */}
            {parseError && <ParsedIntentPanel error={parseError} />}

            {/* Parsed intent */}
            {parsedIntent && <ParsedIntentPanel intent={parsedIntent} />}

            {/* Transaction preview */}
            {txPreview && riskAssessment?.level !== 'BLOCKED' && (
              <TransactionPreviewPanel preview={txPreview} />
            )}

            {/* Safety review */}
            {riskAssessment && <SafetyReviewPanel assessment={riskAssessment} />}

            {/* Confirmation / signing / result */}
            {riskAssessment && (
              <ConfirmationSection
                assessment={riskAssessment}
                txStatus={txStatus}
                txSignature={txSignature}
                txError={txError}
                isSwapDemo={parsedIntent?.action === 'swap'}
                onPrepare={handlePrepare}
                onReset={resetFlow}
              />
            )}

            {/* Security footer */}
            {flowState === 'idle' && (
              <div className="mt-8 space-y-1.5 opacity-60">
                {[
                  'We never custody your private keys.',
                  'You always sign with your own wallet.',
                  'The assistant does not invent token addresses.',
                  'Unsupported or ambiguous intents are blocked.',
                  'This is an MVP. Use small amounts only.',
                ].map((notice, i) => (
                  <p
                    key={i}
                    className="text-xs text-muted-foreground flex items-center gap-2"
                  >
                    <span className="h-1 w-1 rounded-full bg-muted-foreground/40 shrink-0" />
                    {notice}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default Index;
