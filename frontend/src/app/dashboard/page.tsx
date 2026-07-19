import type { Metadata } from 'next';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { DashboardStats } from '@/components/dashboard/DashboardStats';
import { SearchPlaceholder } from '@/components/dashboard/SearchPlaceholder';
import { CreateLinkForm } from '@/components/links/CreateLinkForm';
import { LinkTable } from '@/components/links/LinkTable';
import { DashboardLayout } from '@/components/layout/DashboardLayout';

export const metadata: Metadata = { title: 'Dashboard' };

/** Pure composition — all behavior lives in the section components. */
export default function DashboardPage() {
  return (
    <DashboardLayout>
      <DashboardHeader />
      <div className="space-y-8">
        <DashboardStats />
        <CreateLinkForm />
        <div className="space-y-4">
          <SearchPlaceholder />
          <LinkTable />
        </div>
      </div>
    </DashboardLayout>
  );
}
