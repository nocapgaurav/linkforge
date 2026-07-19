'use client';

import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { CREATE_LINK_URL_INPUT_ID } from '@/components/links/CreateLinkForm';
import { Button } from '@/components/ui/button';

/** Dashboard title block; the CTA drops focus into the create form. */
export function DashboardHeader() {
  return (
    <PageHeader title="Dashboard" description="Manage and monitor your shortened links.">
      <Button onClick={() => document.getElementById(CREATE_LINK_URL_INPUT_ID)?.focus()}>
        <Plus className="size-4" aria-hidden="true" />
        Create Link
      </Button>
    </PageHeader>
  );
}
