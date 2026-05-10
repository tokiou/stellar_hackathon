export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">404</p>
        <h1 className="mt-3 text-3xl font-bold text-on-surface">Page not found</h1>
        <p className="mt-2 text-on-surface-variant">The page you are looking for does not exist.</p>
      </div>
    </main>
  );
}
