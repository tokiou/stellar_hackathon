const items = ['Swap SOL for USDC', 'Send SOL to Alice', 'Portfolio rebalance', 'Check JUP allocation'];

export function ChatHistoryList() {
  return (
    <div className="rounded-3xl border border-outline bg-surface p-4 shadow-sm">
      <p className="mb-3 px-1 text-sm font-semibold text-on-surface">Chat History</p>
      <div className="space-y-1">
        {items.map((item) => (
          <button key={item} className="w-full rounded-xl px-3 py-2 text-left text-sm text-on-surface-variant hover:bg-surface-hover hover:text-on-surface">
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}
