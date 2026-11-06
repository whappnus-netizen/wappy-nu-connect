-- Allow an authenticated organization member to permanently dismiss
-- notifications from their own organization. Read/unread state remains
-- available in the central notification history until explicitly deleted.
drop policy if exists "Members can delete organization notifications" on public.organization_notifications;
create policy "Members can delete organization notifications"
on public.organization_notifications
for delete
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.organization_id = organization_notifications.organization_id
      and m.user_id = (select auth.uid())
  )
);
