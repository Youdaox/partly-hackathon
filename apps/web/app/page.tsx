import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Landing page. Not part of the demo flow — it just points at the two real routes
 * so nobody has to remember the URLs.
 */
export default function Home() {
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-16">
      <p className="text-sm font-medium text-primary">Partli</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        Customer approvals &amp; front desk
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The repairer captures damage in the mobile app. This is where the customer approves
        the quote, and where the front desk watches jobs move.
      </p>

      <div className="mt-8 space-y-3">
        <Link href="/dashboard" className="block">
          <Card className="transition-colors hover:border-primary">
            <CardHeader>
              <CardTitle className="text-base">Front desk dashboard →</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-sm text-muted-foreground">
                Every job and its current status.
              </p>
            </CardContent>
          </Card>
        </Link>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Customer approval page</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground">
              Lives at{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                /approve/&lt;jobId&gt;
              </code>
              . Get a real link by pressing &ldquo;Send to customer&rdquo; in the mobile app.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
