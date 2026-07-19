import type { Metadata } from 'next';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <DashboardLayout>
      <PageHeader title="Settings" description="Manage your workspace preferences." />
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Settings will appear here in an upcoming sprint.
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
