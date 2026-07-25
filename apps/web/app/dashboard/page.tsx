/**
 * Front-desk dashboard — every job and where it has got to.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import type { JobStatus } from '@first-look/shared';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError, api } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Front desk — First Look',
};

// Always render fresh: jobs change while the page is open.
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<JobStatus, string> = {
  capturing: 'Capturing',
  predicted: 'Hidden damage found',
  sent_to_customer: 'Awaiting customer',
  approved: 'Approved',
};

const STATUS_VARIANT: Record<JobStatus, 'secondary' | 'default' | 'success'> = {
  capturing: 'secondary',
  predicted: 'default',
  sent_to_customer: 'default',
  approved: 'success',
};

export default async function DashboardPage() {
  let jobs;
  try {
    jobs = await api.listJobs();
  } catch (error) {
    const apiError = error instanceof ApiError ? error : null;
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle>{apiError?.message ?? 'Could not load jobs'}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {apiError?.detail ?? 'Is the API running? Try `pnpm dev` from the repo root.'}
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  const counts = jobs.reduce<Record<string, number>>((acc, job) => {
    acc[job.status] = (acc[job.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Front desk</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}
          {counts.sent_to_customer ? ` · ${counts.sent_to_customer} awaiting customer` : ''}
          {counts.approved ? ` · ${counts.approved} approved` : ''}
        </p>
      </header>

      {jobs.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No jobs yet. Start one from the mobile app.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => (
            <li key={job.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {job.vehicle.make.toUpperCase()} {job.vehicle.model}
                      {job.vehicle.year ? ` · ${job.vehicle.year}` : ''}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                      {job.vehicle.slug}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Started{' '}
                      {new Date(job.createdAt).toLocaleString('en-NZ', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <Badge variant={STATUS_VARIANT[job.status]}>{STATUS_LABEL[job.status]}</Badge>
                    {job.status === 'sent_to_customer' || job.status === 'approved' ? (
                      <Link
                        href={`/approve/${job.id}`}
                        className="text-sm text-primary underline-offset-4 hover:underline"
                      >
                        View quote
                      </Link>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
