import type { Metadata } from 'next';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/common/PageHeader';
import { ChangePasswordCard } from '@/components/settings/ChangePasswordCard';
import { DeleteAccountCard } from '@/components/settings/DeleteAccountCard';
import { ProfileCard } from '@/components/settings/ProfileCard';
import { SessionsCard } from '@/components/settings/SessionsCard';

export const metadata: Metadata = { title: 'Settings' };

/** Pure composition — all behavior lives in the section components. */
export default function SettingsPage() {
  return (
    <DashboardLayout>
      <PageHeader title="Settings" description="Manage your account." />
      <div className="space-y-6">
        <ProfileCard />
        <ChangePasswordCard />
        <SessionsCard />
        <DeleteAccountCard />
      </div>
    </DashboardLayout>
  );
}
