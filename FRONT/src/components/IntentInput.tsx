import { useState } from 'react';
import type { FC, FormEvent } from 'react';
import { Send, Loader2 } from 'lucide-react';

const EXAMPLE_PROMPTS = [
  'Swap 0.1 SOL to USDC',
  'Buy 0.05 SOL of BONK',
  'Convert 10 USDC to JUP',
  'Send 5 USDC to 9dP...xyz',
  'Transfer 0.01 SOL to 8xK...abc',
];

interface IntentInputProps {
  onSubmit: (text: string) => void;
  isProcessing: boolean;
  disabled: boolean;
}

const IntentInput: FC<IntentInputProps> = ({ onSubmit, isProcessing, disabled }) => {
  const [value, setValue] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim() && !isProcessing && !disabled) {
      onSubmit(value.trim());
    }
  };

  const handleChipClick = (prompt: string) => {
    setValue(prompt);
    if (!isProcessing && !disabled) {
      onSubmit(prompt);
    }
  };

  return (
    <div className="space-y-4">
      {/* Label */}
      <div>
        <label className="text-sm font-medium text-foreground">
          Describe your transaction
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          We translate it into a safe transaction preview. You always sign with your own wallet.
        </p>
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="relative">
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="e.g. Swap 0.1 SOL to USDC"
          disabled={isProcessing || disabled}
          className="w-full rounded-lg border border-border bg-surface-1 px-4 py-3 pr-12 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-50 transition-colors"
        />
        <button
          type="submit"
          disabled={!value.trim() || isProcessing || disabled}
          className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {isProcessing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </form>

      {/* Example chips */}
      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-muted-foreground mr-1 self-center">Try:</span>
        {EXAMPLE_PROMPTS.map((prompt, i) => (
          <button
            key={i}
            onClick={() => handleChipClick(prompt)}
            disabled={isProcessing || disabled}
            className="rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs text-secondary-foreground transition-colors hover:bg-surface-3 hover:border-primary/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
};

export default IntentInput;